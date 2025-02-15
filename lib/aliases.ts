import * as path from "jsr:@std/path";

const CWD: string = Deno.cwd();

export type AliasesJson = {
    aliases: {
        [alias: string]: string,
    },
}

export class Aliases {
    public readonly aliases: ReadonlyMap<string, string>;

    public constructor(aliases: Map<string, string> = new Map()) {
        this.aliases = aliases;
    }

    public getAlias(alias: string): string | undefined {
        return this.aliases.get(alias);
    }

    public setAlias(alias: string, aliasPath: string) {
        (this.aliases as Map<string, string>).set(
            alias,
            path.isAbsolute(aliasPath) ? aliasPath : path.join(CWD, aliasPath)
        );
    }

    public static fromJson(json: AliasesJson) {
        const aliases = new Aliases();
        for (const alias in json.aliases) {
            aliases.setAlias(alias, json.aliases[alias]);
        }
        return aliases;
    }
}
