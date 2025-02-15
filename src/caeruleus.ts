import * as path from "jsr:@std/path";
import * as fs from "https://deno.land/std@0.224.0/fs/mod.ts";

export function getLuauRealPath(filePath: string): string | undefined {
    try {
        const fileInfo = Deno.lstatSync(filePath);
        if (fileInfo.isFile) {
            return Deno.realPathSync(filePath);
        }
    } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
            throw error;
        }
    };
    return undefined;
}

type InstanceObject = {
    name: string,
    className: string,
    filePaths: string[],
    children: InstanceObject[],
}

export class Instance {
    public constructor(name: string, className: string, filePaths?: string[], parent?: Instance, children?: Instance[]) {
        this.m_name = name;
        this.m_className = className;
        this.m_filePaths = filePaths ?? [];
        this.m_parent = parent;
        this.m_children = children ?? [];
        if (parent) parent.children.push(this);
    }

    public static fromObject(object: InstanceObject, parent?: Instance): Instance {
        const instance = new Instance(object.name, object.className, object.filePaths, parent);
        if (object.children) {
            for (const child of object.children) {
                Instance.fromObject(child, instance);
            }
        }
        return instance;
    }

    public static fromJson(json: string): Instance {
        const object = JSON.parse(json);
        return Instance.fromObject(object);
    }

    private m_name: string;

    public get name(): string {
        return this.m_name
    }

    private m_className: string;

    public get className(): string {
        return this.m_className
    }

    private m_filePaths: string[];

    public get filePaths(): string[] {
        return this.m_filePaths
    }

    private m_parent?: Instance = undefined;

    public set parent(parent: Instance) {
        if (this.m_parent) {
            const index = this.m_parent.children.lastIndexOf(this);
            if (index >= 0) {
                this.m_parent.children[index] = this.m_parent.children[this.m_parent.children.length - 1]
                this.m_parent.children.pop()
            }
        }
        this.m_parent = parent
    }

    public get parent(): Instance | undefined {
        return this.m_parent;
    }

    private m_children: Instance[] = [];

    public get children(): Instance[] {
        return this.m_children
    }

    public find(instance: Instance): string | undefined {
        const thisParents = [];
        const instanceParents = []

        {
            // deno-lint-ignore no-this-alias
            let thisParent: Instance | undefined = this;
            do {
                thisParents.push(thisParent);
                thisParent = thisParent.parent;
            } while (thisParent)
        }

        {
            let instanceParent: Instance | undefined = instance;
            do {
                instanceParents.push(instanceParent);
                instanceParent = instanceParent.parent;
            } while (instanceParent)
        }

        let root = thisParents.pop()

        if (root !== instanceParents.pop()) {
            return undefined;
        }

        while (thisParents.length > 0 && instanceParents.length > 0 && thisParents.at(-1) === instanceParents.at(-1)) {
            root = thisParents.pop();
            instanceParents.pop();
        }

        let path = `script${".Parent".repeat(thisParents.length)}`;

        while (instanceParents.length > 0) {
            path += `:FindFirstChild("${instanceParents.pop()?.name}")`;
        }

        return path;
    }
}

export class Sourcemap {
    public constructor(root: Instance) {
        this.m_root = root;
        this.setFilePaths();
    }

    public static fromObject(object: InstanceObject) {
        const root = Instance.fromObject(object);
        return new Sourcemap(root);
    }

    public static fromJson(json: string): Sourcemap {
        const object = JSON.parse(json);
        return Sourcemap.fromObject(object);
    }

    private m_root?: Instance = undefined;

    public get root(): Instance | undefined {
        return this.m_root
    }

    private m_filePathMap: Map<string, [Instance]> = new Map();

    public get(filePath: string): Instance[] | undefined {
        return this.m_filePathMap.get(filePath)
    }

    public async setFilePaths(instance: Instance | undefined = this.m_root) {
        if (instance === undefined) {
            return;
        }
        for (const filePath of instance.filePaths) {
            try {
                const realFilePath = await Deno.realPath(filePath);
                const instances = this.m_filePathMap.get(realFilePath);
                if (instances === undefined) {
                    this.m_filePathMap.set(realFilePath, [instance]);
                } else if (!instances.includes(instance)) {
                    instances.push(instance);
                }
            } catch (error) {
                if (!(error instanceof Deno.errors.NotFound)) {
                    throw error;
                }
            }
        }
        for (const child of instance.children) {
            await this.setFilePaths(child);
        }
    }

    public async replaceRequires(filePath: string, aliases?: Map<string, string>) {
        const fileInstance = this.m_filePathMap.get(filePath)?.[0]
        if (fileInstance === undefined) {
            console.error(`Couldn't get instance associated with path '${filePath}'`);
            return;
        }
        const luau = await Deno.readTextFile(filePath);
        const replacedRequires = luau.replaceAll(/\brequire\("(.*?)"\)\B/g, (_, requirePath: string): string => {
            if (aliases && requirePath.startsWith("@")) {
                const [alias, ...other] = requirePath.substring(1).split("/", 1);
                const replacement = aliases.get(alias);
                if (replacement !== undefined) {
                    requirePath = path.join(replacement, ...other);
                } else {
                    console.warn(`Couldn't get alias '@${alias}', are you sure it exists?`);
                }
            }
            const virtualFilePath = path.isAbsolute(requirePath) ? requirePath : path.join(path.dirname(filePath), requirePath)
            const otherFilePath =
                getLuauRealPath(virtualFilePath)
                ?? getLuauRealPath(`${virtualFilePath}.luau`)
                ?? getLuauRealPath(path.join(virtualFilePath, "init.luau"));
            if (otherFilePath == undefined) {
                console.error(`Couldn't find file path '${requirePath}', required by '${filePath}'`);
                return `require("${requirePath}")`;
            }
            const otherInstance = this.m_filePathMap.get(otherFilePath)?.[0];
            if (otherInstance === undefined) {
                console.error(`Couldn't get instance associated with path '${otherFilePath}' (${requirePath}), required by '${filePath}'`);
                return `require("${requirePath}")`;
            }
            const route = fileInstance.find(otherInstance);
            return route ? `require(${route})` : "error(\"unreachable\")";
        });
        await Deno.writeTextFile(filePath, replacedRequires);
    }
}

if (import.meta.main) {
    const INPUT = Deno.args.slice(1);
    const OUTPUT = "output";

    for (const input of INPUT) {
        const output = path.join(OUTPUT, input);
        await fs.emptyDir(output);
        await fs.copy(input, output, { overwrite: true });
    }

    const luaurc = await Deno.readTextFile(".luaurc");
    const luaurcJson = JSON.parse(luaurc);
    const aliases = new Map();

    if (luaurcJson.aliases !== undefined) {
        for (const alias in luaurcJson.aliases) {
            aliases.set(alias, await Deno.realPath(luaurcJson.aliases[alias]));
        }
    }

    const sourcemap = Sourcemap.fromJson(await Deno.readTextFile("sourcemap.json"));

    for await (const dirEntry of fs.walk(OUTPUT)) {
        if (!dirEntry.isFile || path.extname(dirEntry.name) !== ".luau") {
            continue;
        }
        const filePath = await Deno.realPath(dirEntry.path);
        await sourcemap.replaceRequires(filePath, aliases);
    }

    const events = Deno.watchFs(INPUT, { recursive: true });

    for await (const event of events) {
        const inputPath = event.paths[0];
        const relativeInputPath = path.relative("./", inputPath);
        const relativeOutputPath = path.join(OUTPUT, relativeInputPath);
        const outputPath = path.join(Deno.cwd(), relativeOutputPath);
        switch (event.kind) {
            case "create":
            case "rename":
            case "modify": {
                await Deno.copyFile(inputPath, outputPath);
                if (path.extname(relativeInputPath) == ".luau") {
                    await sourcemap.replaceRequires(outputPath, aliases);
                }
                console.log(`Update '${relativeOutputPath}' ('${relativeInputPath}')`);
                break;
            }

            case "remove": {
                await Deno.remove(outputPath, { recursive: true });
                console.log(`Remove '${relativeOutputPath}'`);
                break;
            }
        }
    }
}