import { Aliases } from "./aliases.ts";
import { SourceMap, SourceMapEntry } from "./source_map.ts";

import * as path from "jsr:@std/path";

export function replaceRequires(
    scriptContent: string,
    script: SourceMapEntry,
    scriptPath: string,
    sourceMap: SourceMap,
    aliases: Aliases
): string {
    return scriptContent.replaceAll(
        /\brequire\s*\(\s*"([^"]*?)"\s*\)\B/g,
        (_, requirePath: string): string => {
            const [head, ...tail] = requirePath.split(/\/|\\/);
            console.log(head);
            if (head.startsWith("@")) {
                const alias = head.substring(1);
                const aliasPath = aliases.getAlias(alias);
                if (aliasPath) {
                    requirePath = path.resolve(aliasPath, ...tail);
                }
            }
            requirePath = path.isAbsolute(requirePath) ? requirePath : path.join(scriptPath, requirePath);
            const required =
                   sourceMap.filePaths.get(`${requirePath}.luau`)?.[0]
                ?? sourceMap.filePaths.get(path.join(requirePath, "init.luau"))?.[0]
                ?? sourceMap.filePaths.get(requirePath)?.[0];
            if (!required) throw new Error(`Couldn't find file path '${requirePath}' in source map`);
            return `require(${script.getPath(required)})`;
        }
    );
}
