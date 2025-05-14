'use strict';
const optionsDefault = {
    attachValueType: true,
    indentCharacter: `|`,
    indentedSpacing: 4,
    arrLimitNewline: 40,
    grpLimitNewline: 40,
    invokePrototype: true,
    FilteredObjects: [
        Object.prototype,
    ],
    invokeAsyncData: {
        enabled: true,
        timeout: 100,
    },
    invokeFunctions: {
        enabled: false,
        safeish: false,
        unsafer: false,
        specific: {
            enabled: false,
            allowlist: [],
        },
        deranged: {
            enabled: false,
            blocklist: [],
            fnArgs: [],
        },
    },
    // add filterlist for prototype
};
const wellKnown = Reflect.ownKeys(Symbol).map(key => Symbol[key]).filter(value => typeof value === `symbol`);
export function log(...args) {
    logCustom({ attachValueType: true }, ...args);
}
export function logCustom(options, ...args) {
    const header = `[${new URL(import.meta.url).pathname.slice(1)}].${log.name}`;
    const spacer = `\n\n${`-`.repeat(35)}\n\n`;
    const expObj = new Map();
    console.log(`${header}${args.map((arg, num) => {
        try {
            const keys = arg && typeof arg === `object` ? Reflect.ownKeys(arg) : [];
            const captured = keys.length === 1 && valueType(arg) === `Object`;
            const [name, data] = captured ? [keyToStr(keys[0]), arg[keys[0]]] : [`<${valueType(arg)}>`, arg];
            return `${spacer}[${num}]: ${captured ? `${format(name)} = ` : ``}${format(new Target(
                data, name, [name]
            ), options, expObj)}`;
        } catch (error) {
            return `${spacer}[${num}]: ${format(error)}`;
        }
    }).join(``)}`);
    // make objDone to Map, filter all entries above 1, print last
}
export function format(arg, options = {}, expObj) {
    /*
        // _iterable: x => use Iterator.prototype.take, spread iterator,
        // create object with resulting array and receiver object and pass to formatObj
        // add function newline (newline low amount of function)
        // add function invocation
        // add date object output

    */
    const target = Target.normalize(arg);
    const { data, receiver } = target;
    const { attachValueType = false } = options;
    const dispatch = [
        //iterable
        //asynciterable (await with timeout)
        //Promise (.then)
        //toJSON
        //HTMLAllCollection
        [`null`, data === null],
        [`date`, data instanceof Date],
        [`error`, data instanceof Error],
        [`array`, isArrayLikeOnly(data, receiver)],
    ].find(([, predicate]) => predicate)?.[0] ?? typeof data;
    return `${attachValueType ? `<${valueType(data)}>` : ``}${({
        function: () => `[${data.name}]`,
        string: () => `["${data}"]`,
        symbol: () => keyToStr(data),
        object: () => formatObject(target, options, expObj),
        array: () => formatArray(target, options, expObj),
    })[dispatch]?.() ?? `[${String(data)}]`}`;
}
export function formatIterable(arg, options, expObj) {
    const opts = normalizeOptions(options);
    const target = Target.normalize(arg);
    const { data } = target;
    const size = parseInt(data.size) || parseInt(data.length) || 20;
    const iter = data[Symbol.iterator];
}
export function formatArray(arg, options, expObj) {
    const opts = normalizeOptions(options);
    const target = Target.normalize(arg);
    const { indent, indentPrev } = indentation(target, opts);
    const arr = Array.from(target.receiver);
    const newline = arr.length < opts.arrLimitNewline;
    const str = (delim, add) => `(${arr.length})[${delim}${arr.map((item, index) => {
        if (typeof item !== `object`) return format(item, opts);
        const name = `${target.name}[${index}]`;
        return format(new Target(
            item, name, target.path.concat(name), newline ? indent : indentPrev
        ), opts, expObj);
    }).join(`,${delim}`)}${add}]${formatName(target.pathResolve())}`;
    return !arr.length ? `(0)[]` : newline ? str(indent, indentPrev) : str(` `, ` `);
}
export function formatObject(arg, options, expObj = new Map()) {
    const opts = normalizeOptions(options);
    const target = Target.normalize(arg);
    const { indent, indentPrev } = indentation(target, opts);
    const { data, name, receiver, path } = target;
    const objExpanded = expObj.get(data);
    const ptype = Object.getPrototypeOf(data);
    const keys = Reflect.ownKeys(data);
    const formatOut = str => `(${keys.length}){${indent}${str}${indentPrev}}`;
    const identifyObj = obj => obj?.name || obj?.constructor.name || valueType(obj);
    const filterObj = arg => opts.FilteredObjects.find(obj => obj === arg);
    const filterTarget = filterObj(data);
    const filterPrototype = filterObj(ptype);
    if (Boolean(filterTarget)) {
        return formatOut(`filtered-object-( ${identifyObj(filterTarget)} )`);
    }
    if (Boolean(filterPrototype) && !keys.length) {
        return formatOut(`filtered-prototype-( ${identifyObj(filterPrototype)} )`);
    }
    if (Boolean(objExpanded)) {
        return formatOut(`shallow-copy-of-( ${(
            objExpanded.push(path), objExpanded[0].join(`.`)
        )} )`);
    }
    expObj.set(data, [path]);
    const formatEntry = (pad, [key, value]) =>
        `${format(key).padEnd(pad)} = ${typeof value !== `object` ? format(value, opts) : format(new Target(
            value, key, path.concat(keyToStr(key)), indent
        ), opts, expObj)}${descriptorDiffer(data, key)}${indent}`;
    class PropertyGroup {
        constructor(formatter, header, predicate, validator = function() {
            return this.entries.length !== 0;
        }) {
            this.formatter = this[formatter];
            this.header = header;
            this.predicate = predicate;
            this.validator = validator;
            this.entries = [];
        }
        formatKeys() {
            return `${this.header}(${this.entries.length})${indent}${this.entries.map(
                ([key]) => `${format(key)}${descriptorDiffer(data, key)}`
            ).join(this.entries.length < opts.grpLimitNewline ? indent : `,`)}${indent}`;
        }
        formatEntries() {
            const pad = this.entries.reduce((max, [key]) => Math.max(max, format(key).length), 0);
            return `${this.header}(${this.entries.length})${indent}${this.entries.map(
                formatEntry.bind(null, pad)
            ).join(``)}`;
        }
        formatPrototype() {
            const ptypeType = `[[${valueType(ptype)}]]`;
            return `${indentPrev}|[getPrototypeOf( ${keyToStr(name)} )] = ${format(new Target(
                ptype, `${keyToStr(name)}.${ptypeType}`, path.concat(ptypeType), indentPrev + `|`, receiver
            ), opts, expObj)}`;
        }
        formatArrayLike() {
            return null; // array item name to array[index]
        }
        formatIterable() {
            return null;
        }
    }
    const isArrayLikeObj = isArrayLike(data, receiver);
    const isArrayLikeItem = (_, k) => isArrayLikeObj && parseInt(String(k)) >= 0;
    //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
    //unroll iterator, filter keys if items contain keys from object
    const tag = ([str]) => `${indentPrev}|${`-#`.padStart(opts.indentedSpacing, `-`)} ${str}`;
    const groups = [
        new PropertyGroup(`formatEntries`, tag`primitive`, () => false),
        new PropertyGroup(`formatEntries`, tag`array-item`, isArrayLikeItem),
        new PropertyGroup(`formatEntries`, tag`getter`, (v, k) => v != null && isGetter(data, k)),
        new PropertyGroup(`formatEntries`, tag`array`, (v, k) => isArrayLike(v, receiver[k])),
        new PropertyGroup(`formatEntries`, tag`object`, v => Boolean(v) && typeof v === `object`),
        new PropertyGroup(`formatKeys`, tag`function`, v => typeof v === `function`),
        new PropertyGroup(`formatKeys`, tag`null`, v => v === null),
        new PropertyGroup(`formatKeys`, tag`undefined`, v => v === undefined),
        new PropertyGroup(`formatPrototype`, ``, () => false, () => true),
    ];
    // add array and iterable keys into Set, filter keys based on that
    keys.map(key => {
        try {
            return [key, Reflect.get(data, key, receiver)];
        } catch (error) {
            return [key, error];
        }
    }).toSorted((a, b) => [
        [typeof a[0], typeof b[0]],
        [typeof a[1], typeof b[1]],
        [String(a[0]), String(b[0])],
    ].map(([lhs, rhs]) =>
        lhs !== rhs ? lhs > rhs ? 1 : -1 : 0
    ).find(Boolean) ?? 0).forEach(entry => (groups.find(
        ({ predicate }) => predicate(entry[1], entry[0])
    ) ?? groups[0]).entries.push(entry));
    return `(${keys.length}){${indent}${groups.filter(
        group => group.validator()
    ).map(
        group => group.formatter()
    ).join(``)}${indentPrev}}${formatName(
        data === receiver ? target.pathResolve() : name
    )}`;
}
export function formatName(str) {
    return `( ${str} )`;
}
export function keyToStr(key) {
    if (typeof key === `string`) return key;
    const desc = key.description;
    return `[${wellKnown.includes(key) ? desc : Boolean(desc) ? `Symbol("${desc}")` : `Symbol()`}]`;
}
export function valueType(arg) {
    return typeof arg !== `object` ? typeof arg : Object.prototype.toString.call(arg).slice(8, -1);
}
export function indentation(target = {}, options = {}) {
    const {
        indent = `\n`
    } = target;
    const {
        indentCharacter = `|`,
        indentedSpacing = 2,
    } = options;
    return {
        indent: `${indent}${indentCharacter.padEnd(indentedSpacing, ` `)}`,
        indentPrev: indent,
    };
}
export function isIterable(arg) {
    return Boolean(arg) && typeof arg === `object` && typeof arg[Symbol.iterator] === `function`;
}
export function isArrayLikeOnly(arg, receiver) {
    const access = receiver ?? arg;
    return isArrayLike(arg, receiver) && access.length === Reflect.ownKeys(arg).length - 1;
}
export function isArrayLike(arg, receiver) {
    const access = receiver ?? arg;
    return Boolean(arg) && typeof arg === `object` && Number.isInteger(access.length) && access.length >= 0;
}
export function isGetter(obj, key) {
    return typeof Reflect.getOwnPropertyDescriptor(obj, key)?.get === `function`;
}
export function descriptorDiffer(obj, key) {
    const descriptor = Reflect.getOwnPropertyDescriptor(obj, key) ?? {};
    const descDiffer = [
        [`C`, descriptor.configurable === false],
        [`E`, descriptor.enumerable === false],
        [`W`, descriptor.writable === false],
        [`G`, typeof descriptor.get === `function`],
        [`S`, typeof descriptor.set === `function`],
    ].filter(([, predicate]) => predicate).map(([key]) => key).join(``);
    return Boolean(descDiffer) ? `'${descDiffer}` : ``;
}
export function templateBreak({ raw }, ...args) {
    return String.raw({ raw: raw.map(str => str.replace(/\n\s*/g, ``).replace(/\\n/g, `\n`)) }, ...args);
}
export function normalizeOptions(options = {}) {
    return { ...optionsDefault, ...options };
}
class Target {
    #receiver;
    constructor(data, name, path, indent, receiver) {
        this.data = data;
        this.name = name;
        this.path = path;
        this.indent = indent;
        this.#receiver = receiver;
    }
    get receiver() {
        return this.#receiver ?? this.data;
    }
    set receiver(arg) {
        this.#receiver = arg;
    }
    pathResolve() {
        return Boolean(this.path?.length) ? this.path.join(`.`) : this.name;
    }
    static normalize(arg) {
        return arg instanceof this ? arg : new this(arg);
    }
}