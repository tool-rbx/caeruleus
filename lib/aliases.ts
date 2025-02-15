export type AliasesJson = {
    aliases: {
        [alias: string]: string,
    },
}

export class Aliases {
    public readonly aliases: ReadonlyMap<string, string>;

    public constructor(aliases: Map<string, string>) {
        this.aliases = aliases;
    }

    public getAlias(alias: string): string | undefined {
        return this.aliases.get(alias);
    }

    public setAlias(alias: string, path: string) {
        (this.aliases as Map<string, string>).set(alias, path)
    }

    public static fromJson(json: AliasesJson) {
        const aliases = new Map();
        for (const alias in json.aliases) {
            aliases.set(alias, json.aliases[alias]);
        }
        return new Aliases(aliases);
    }
}
