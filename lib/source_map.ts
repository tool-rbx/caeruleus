import * as path from "jsr:@std/path";

const CWD: string = Deno.cwd();

export class SourceMapEntry {
    public name: string;
    public readonly children: readonly SourceMapEntry[] = [];
    private m_parent?: SourceMapEntry = undefined;
    private m_parentIndex: number = -1;

    public constructor(name: string, parent?: SourceMapEntry) {
        this.name = name;
        this.parent = parent;
    }

    public get parent(): SourceMapEntry | undefined {
        return this.m_parent;
    }

    public set parent(parent: SourceMapEntry | undefined) {
        const previousParent = this.m_parent;
        const previousParentIndex = this.m_parentIndex;
        if (parent === previousParent) return;
        this.m_parent = parent;
        this.m_parentIndex = ((parent?.children as SourceMapEntry[])?.push(this) ?? 0) - 1;
        if (!previousParent) return;
        const children = previousParent.children as SourceMapEntry[];
        const last = children.pop() as SourceMapEntry;
        if (this === last) return;
        last.m_parentIndex = previousParentIndex;
        children[previousParentIndex] = last;
    }

    public *getParents(): Generator<SourceMapEntry> {
        let parent = this.parent;
        while (parent) {
            yield parent;
            parent = parent.parent;
        }
    }

    public getChildren(): ArrayIterator<SourceMapEntry> {
        return this.children.values();
    }

    public *getDescendants(): Generator<[number, SourceMapEntry]> {
        for (const child of this.children) {
            yield [0, child];
            for (const [depth, descendant] of child.getDescendants()) {
                yield [depth + 1, descendant];
            }
        }
    }

    public getPath(other: SourceMapEntry): string {
        if (this === other) return "script";

        const thisParents = [this, ...this.getParents()];
        const otherParents = [other, ...other.getParents()];

        if (thisParents.pop() !== otherParents.pop()) throw new Error("The entries are unrelated");

        while (thisParents.length > 0 && otherParents.length > 0 && thisParents.at(-1) === otherParents.at(-1)) {
            thisParents.pop();
            otherParents.pop();
        }

        let path = `script${".Parent".repeat(thisParents.length)}`;

        while (otherParents.length > 0) {
            path += `:FindFirstChild("${otherParents.pop()?.name}")`;
        }

        return path;
    }
}

export type SourceMapJson = {
    readonly name: string;
    readonly className: string;
    readonly filePaths?: readonly string[];
    readonly children?: readonly SourceMapJson[];
};

export class SourceMap {
    public readonly filePaths: ReadonlyMap<string, readonly SourceMapEntry[]> = new Map();
    private m_root!: SourceMapEntry;

    private constructor() {}

    public get root(): SourceMapEntry {
        return this.m_root;
    }

    private pushFilePath(filePath: string, ...values: SourceMapEntry[]) {
        const entries = this.filePaths.get(filePath);
        if (entries === undefined) {
            (this.filePaths as Map<string, SourceMapEntry[]>).set(filePath, values);
        } else {
            (entries as SourceMapEntry[]).push(...values);
        }
    }

    private getEntryFromJson(json: SourceMapJson, parent?: SourceMapEntry): SourceMapEntry {
        const entry = new SourceMapEntry(json.name, parent);
        if (json.filePaths) {
            for (const filePath of json.filePaths) {
                this.pushFilePath(
                    path.isAbsolute(filePath) ? filePath : path.join(CWD, filePath),
                    entry,
                );
            }
        }
        if (json.children) {
            for (const child of json.children) this.getEntryFromJson(child, entry);
        }
        return entry;
    }

    public static fromJson(json: SourceMapJson): SourceMap {
        const sourceMap = new SourceMap();
        sourceMap.m_root = sourceMap.getEntryFromJson(json);
        return sourceMap;
    }
}
