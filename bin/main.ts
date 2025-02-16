import { Aliases } from "../lib/aliases.ts";
import { replaceRequires } from "../lib/script.ts";
import { SourceMap } from "../lib/source_map.ts";

import * as path from "jsr:@std/path";
import * as fs from "jsr:@std/fs";
import { debounce } from "jsr:@std/async/debounce";

const CWD: string = Deno.cwd();

export const VERSION: string = "0.1.0";

export function help() {
    console.log(
        "%c" + "Caeruleus" + "%c v" + VERSION,
        "color: blue; font-weight: bold;",
        "color: blue;",
    );
    console.log("/kae̯ˈru.le.us/ is a preprocessor for Luau projects\n");
    console.log(
        "%c" + "Usage:",
        "color: blue;",
    );
    console.log(`\t${path.basename(Deno.execPath())} [OPTIONS]\n`);
    console.log(
        "%c" + "Options:",
        "color: blue;",
    );
    console.log(
        "\t-h, --help           \tShow help and exit\n" +
            "\t-V, --version        \tShow version and exit",
    );
    console.log(
        "\t-W                   \tEnable file watching mode (build on change)",
    );
    console.log(
        "\t-i, --input <input>  \tSet input file or directory\n" +
            "\t                     \t\t%c" + "If omitted, defaults to ./",
        "color: black;",
    );
    console.log(
        "\t-o, --output <output>\tSet output file or directory for the preceding input.\n" +
            "\t                     \t\t%c" + "If omitted, defaults to ./output/<input>.",
        "color: black;",
    );
}

export function fatalError(message: string): never {
    console.error(`%cFatal Error: %c${message}`, "color: red; font-weight: bold;", "");
    Deno.exit(1);
}

export function error(message: string) {
    console.error(`%cError: %c${message}`, "color: red;", "");
}

export function warning(message: string) {
    console.warn(`%cWarning: %c${message}`, "color: yellow;", "");
}

export function note(message: string) {
    console.warn(`\t%c${message}`, "color: black;");
}

function levenshteinDistance(a: string, b: string): number {
    const dp: number[][] = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));

    for (let i = 0; i <= a.length; i++) dp[i][0] = i;
    for (let j = 0; j <= b.length; j++) dp[0][j] = j;

    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = a[i - 1] === b[j - 1]
                ? dp[i - 1][j - 1]
                : Math.min(dp[i - 1][j - 1], dp[i][j - 1], dp[i - 1][j]) + 1;
        }
    }

    return dp[a.length][b.length];
}

export function suggestArgument(arg: string) {
    const validArgs = ["-h", "--help", "-V", "--version", "-W", "-i", "--input", "-o", "--output"];
    let bestMatch: string | undefined = undefined;
    let minDistance = Infinity;
    for (const validArg of validArgs) {
        const lowerDistance = levenshteinDistance(arg.toLowerCase(), validArg);
        const upperDistance = levenshteinDistance(arg.toUpperCase(), validArg);
        const distance = Math.min(lowerDistance, upperDistance);
        if (distance < minDistance && distance <= 2) {
            minDistance = distance;
            bestMatch = validArg;
        }
    }
    return bestMatch;
}

if (Deno.args.length === 0) {
    help();
    console.log();
    error("Expected -h, --help, -V, --version, -W, -i, --input, -o, or --output");
    Deno.exit(0);
}
let fileWatchingMode: boolean = false;
const inputPaths: [string, string][] = [];
let index = 0;
do {
    const arg = Deno.args.at(index);
    switch (arg) {
        case "-W": {
            if (fileWatchingMode) {
                warning("Flag '-W' set multiple times");
                note("File watching mode is already enabled");
            }
            fileWatchingMode = true;
            break;
        }
        case "-h":
        case "--help": {
            help();
            Deno.exit(0);
            break;
        }
        case "-V":
        case "--version": {
            console.log(`Caeruleus ${VERSION}`);
            Deno.exit(0);
            break;
        }
        case "-i":
        case "--input": {
            const input = Deno.args.at(++index);
            if (input === undefined) {
                fatalError(`Expected input file path after '${arg}' argument`);
            }
            let output = `./output/${input}`;
            const outputArg = Deno.args.at(index + 1);
            if (outputArg === "-o" || outputArg === "--output") {
                const outputArgOutput = Deno.args.at(index += 2);
                if (outputArgOutput === undefined) {
                    fatalError(`Expected output file path after '${outputArg}' argument (from '${arg}' argument)`);
                }
                output = outputArgOutput;
            }
            inputPaths.push([input, output]);
            break;
        }
        case "-o":
        case "--output": {
            const output = Deno.args.at(++index);
            if (output === undefined) {
                fatalError(`Expected output file path after '${arg}' argument`);
            }
            inputPaths.push([".", output]);
            break;
        }
        default: {
            warning(
                `Unknown argument '${arg}' encountered, expected -h, --help, -V, --version, -W, -i, --input, -o, or --output`,
            );
            const suggestion = suggestArgument(arg as string);
            if (suggestion) {
                note(`Did you mean '${suggestion}'?`);
            }
            break;
        }
    }
} while (++index < Deno.args.length);

export async function getAliases(): Promise<Aliases> {
    try {
        const luaurc = await Deno.readTextFile(".luaurc");
        const json = JSON.parse(luaurc);
        if (json.aliases) return Aliases.fromJson(json);
    } catch (err) {
        warning("Couldn't get aliases from .luaurc");
        error(`${err}`);
    }
    return new Aliases();
}

let aliases: Aliases = await getAliases();

export async function getSourceMap(): Promise<SourceMap> {
    try {
        const sourceMapJson = await Deno.readTextFile("sourcemap.json");
        const json = JSON.parse(sourceMapJson);
        return SourceMap.fromJson(json);
    } catch (err) {
        warning("Couldn't get source map from sourcemap.json");
        fatalError(`${err}`);
    }
}

let sourceMap: SourceMap = await getSourceMap();

for (const [input, output] of inputPaths) {
    try {
        await fs.emptyDir(output);
    } catch (err) {
        warning(`Couldn't empty output directory '${output}'`);
        error(`${err}`);
    }
    try {
        await fs.copy(input, output, { overwrite: true });
    } catch (err) {
        warning(`Couldn't copy '${input}' to '${output}'`);
        error(`${err}`);
    }
}

export async function run(inputPaths: [string, string][]) {
    for (const [input, output] of inputPaths) {
        for await (const inputEntry of fs.walk(input, { exts: [".luau"] })) {
            const relativePath = path.relative(input, inputEntry.path);
            const inputPath = path.resolve(CWD, input, relativePath);
            const outputPath = path.resolve(CWD, output, relativePath);
            try {
                const script = sourceMap.filePaths.get(inputPath)?.[0];
                if (script === undefined) {
                    error(`Couldn't get script at path '${inputPath}'`);
                    continue;
                }
                const scriptContent = await Deno.readTextFile(inputPath);
                const replacedRequires = replaceRequires(scriptContent, script, inputPath, sourceMap, aliases);
                await Deno.writeTextFile(outputPath, replacedRequires);
            } catch (err) {
                warning(`Couldn't update '${inputPath}' to '${outputPath}'`);
                error(`${err}`);
            }
        }
    }
}

await run(inputPaths);

if (!fileWatchingMode) Deno.exit(0);

export async function watchAliases() {
    const events = Deno.watchFs(".luaurc");

    const setAliases = debounce(async (event: Deno.FsEvent) => {
        switch (event.kind) {
            case "create":
            case "modify":
            case "rename":
            case "remove": {
                console.log("%cInfo: %c.luaurc file updated", "color: green; font-weight: bold;", "");
                aliases = await getAliases();
                await run(inputPaths);
                break;
            }
        }
    }, 100);

    for await (const event of events) {
        setAliases(event);
    }
}

watchAliases();

export async function watchSourceMap() {
    const events = Deno.watchFs("sourcemap.json");

    const setSourceMap = debounce(async (event: Deno.FsEvent) => {
        switch (event.kind) {
            case "create":
            case "modify":
            case "rename":
            case "remove": {
                console.log("%cInfo: %csourcemap.json file updated", "color: green; font-weight: bold;", "");
                sourceMap = await getSourceMap();
                await run(inputPaths);
                break;
            }
        }
    }, 100);

    for await (const event of events) {
        setSourceMap(event);
    }
}

watchSourceMap();

export async function watchInputPath(input: string, output: string) {
    const events = Deno.watchFs(input, { recursive: true });

    const onInputPathChanged = debounce(async (event: Deno.FsEvent) => {
        const relativePath = path.relative(input, event.paths[0]);
        const inputPath = path.resolve(CWD, input, relativePath);
        const outputPath = path.resolve(CWD, output, relativePath);
        switch (event.kind) {
            case "create":
            case "modify": {
                console.log(`%cInfo: %c'${inputPath}' file updated`, "color: green; font-weight: bold;", "");
                if (path.extname(inputPath) === ".luau") {
                    try {
                        const script = sourceMap.filePaths.get(inputPath)?.[0];
                        if (script === undefined) {
                            error(`Couldn't get script at path '${inputPath}'`);
                            return;
                        }
                        const scriptContent = await Deno.readTextFile(inputPath);
                        const replacedRequires = replaceRequires(scriptContent, script, inputPath, sourceMap, aliases);
                        await Deno.writeTextFile(outputPath, replacedRequires);
                    } catch (err) {
                        warning(`Couldn't update '${inputPath}' to '${outputPath}'`);
                        error(`${err}`);
                    }
                } else {
                    await fs.copy(inputPath, outputPath, { overwrite: true });
                }
                break;
            }

            case "remove": {
                console.log(`%cInfo: %c'${inputPath}' file removed`, "color: green; font-weight: bold;", "");
                try {
                    await Deno.remove(outputPath);
                } catch (err) {
                    if (!(err instanceof Deno.errors.NotFound)) {
                        throw err;
                    }
                }
                break;
            }
        }
    }, 100);

    for await (const event of events) {
        onInputPathChanged(event);
    }
}

for (const [input, output] of inputPaths) {
    watchInputPath(input, output);
}
