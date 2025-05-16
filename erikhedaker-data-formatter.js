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
};
const wellknown = Reflect.ownKeys(Symbol).map(key => Symbol[key]).filter(value => typeof value === `symbol`);
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
            const [name, data] = captured ? [keys[0], arg[keys[0]]] : [`<${valueType(arg)}>`, arg];
            const prepend = captured ? `${format(name)} = ` : ``;
            return `${spacer}[${num}]: ${prepend}${format(new Target(data, name, [name]), options, expObj)}`;
        } catch (error) {
            return `${spacer}[${num}]: ${format(error)}`;
        }
    }).join(``)}`);
    // make objDone to Map, filter all entries above 1, print last
}
export function format(arg, options = { attachValueType: false }, expObj) {
    /*
        // _iterable: x => use Iterator.prototype.take, spread iterator,
        // create object with resulting array and receiver object and pass to formatObj
        // add function newline (newline low amount of function)
        // add function invocation
        // add date object output
    */
    const opts = normalizeOptions(options);
    const target = Target.normalize(arg);
    const { data, receiver } = target;
    const filtered = formatFiltered(target, opts, expObj);
    const dispatch = [
        //iterable
        //asynciterable (await with timeout)
        //Promise (.then)
        //toJSON
        //HTMLAllCollection
        [`filtered`, Boolean(filtered)],
        [`null`, data === null],
        [`date`, data instanceof Date],
        [`error`, data instanceof Error],
        [`array`, isArrayLikeOnly(data, receiver)],
    ].find(selectPredicate)?.[0] ?? typeof data;
    return `${opts.attachValueType ? `<${valueType(data)}>` : ``}${({
        filtered: () => filtered,
        function: () => `[${data.name}]`,
        string: () => `["${data}"]`,
        symbol: () => formatSymbol(data),
        object: () => formatObject(target, opts, expObj),
        array: () => formatArray(target, opts, expObj),
    })[dispatch]?.() ?? `[${String(data)}]`}`;
}
function formatFiltered(target, opts, expObj) {
    const { data, path } = target;
    if (Boolean(data) && typeof data === `object`) {
        //const identifyObj = obj => obj?.name || obj?.constructor.name || valueType(obj);
        const { indent, indentPrev } = indentation(target, opts);
        const formatOut = (prepend, append, str) => `{${prepend}${str}${append}}`;
        const formatOutput = str => formatOut(str, indent, indentPrev);
        const formatSimple = str => formatOut(str, ``, ``);
        const filterObj = arg => opts.FilteredObjects.find(obj => obj === arg);
        const prtype = Object.getPrototypeOf(data);
        const keys = Reflect.ownKeys(data);
        const targetFiltered = filterObj(data);
        const prtypeFiltered = filterObj(prtype);
        const targetExpanded = expObj.get(data);
        const prtypeExpanded = expObj.get(prtype);
        if (Boolean(targetFiltered)) {
            return formatSimple(`is-filtered`);
        }
        if (Boolean(prtypeFiltered) && !keys.length) {
            return formatSimple(`is-filtered`);
        }
        if (Boolean(targetExpanded)) {
            targetExpanded.push(path);
            return formatOutput(`is-copy-of-( ${targetExpanded[0].join(`.`)} )`);
        }
        if (Boolean(prtypeExpanded) && !keys.length) {
            prtypeExpanded.push(path);
            return formatOutput(`is-copy-of-( ${prtypeExpanded[0].join(`.`)} )`);
        }
    }
    return null;
}
function formatIterable(target, opts, expObj) {
    const { data } = target;
    const size = parseInt(data.size) || parseInt(data.length) || 20;
    const iter = data[Symbol.iterator];
}
function formatArray(target, opts, expObj) {
    const { indent, indentPrev } = indentation(target, opts);
    const { name, path, receiver } = target;
    const arr = Array.from(receiver);
    const newline = arr.length < opts.arrLimitNewline;
    const str = (delim, add) => `(${arr.length})[${delim}${arr.map((item, index) => {
        const indexed = `${name}[${index}]`;
        return format(new Target(item, indexed, path.concat(indexed), newline ? indent : indentPrev), opts, expObj);
    }).join(`,${delim}`)}${add}]${formatOrigin(target.pathResolve())}`;
    return !arr.length ? `(0)[]` : newline ? str(indent, indentPrev) : str(` `, ` `);
}
function formatObject(arg, opts, expObj = new Map()) {
    //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
    //unroll iterator, filter keys if items contain keys from object
    const target = Target.normalize(arg);
    const { indent, indentPrev } = indentation(target, opts);
    const { data, name, receiver, path } = target;
    const isArrayLikeObj = isArrayLike(data, receiver);
    const keys = Reflect.ownKeys(data);
    expObj.set(data, [path]);
    const formatPropertyKeys = properties => {
        const newline = properties.length < opts.grpLimitNewline;
        return properties.map(([key, _, desc]) =>
            format(key) + formatDescriptor(desc)
        ).join(newline ? indent : `,`) + indent;
    };
    const formatProperties = properties => {
        const longest = (max, [key]) => max.length > key.length ? max : key;
        const pad = format(properties.reduce(longest, ``)).length;
        return properties.map(([key, value, desc]) => format(key).padEnd(pad) + ` = ` + format(
            new Target(value, key, path.concat(formatAccess(key)), indent), opts, expObj
        ) + formatDescriptor(desc) + indent).join(``);
    };
    const formatPrototype = () => {
        const prtype = Object.getPrototypeOf(data);
        const access = formatAccess(name);
        const prtypeType = `[[${valueType(prtype)}]]`;
        return `${indentPrev}|[getPrototypeOf( ${access} )] = ${format(new Target(
            prtype, `${access}.${prtypeType}`, path.concat(prtypeType), indentPrev + `|`, receiver
        ), opts, expObj)}`;
    };
    const PropertyGroup = class {
        constructor(formatter, header, predicate, validator = function() {
            return this.properties.length !== 0;
        }) {
            this.properties = [];
            this.formatter = () => (header ? `${indentPrev}${opts.indentCharacter}${`-#`.padStart(
                opts.indentedSpacing, `-`
            )} ${header}(${this.properties.length})${indent}` : ``) + formatter(this.properties);
            this.predicate = predicate;
            this.validator = validator;
        }
    };
    const groups = [
        new PropertyGroup(formatProperties, `primitive`, () => false),
        new PropertyGroup(formatProperties, `array-item`, ([k]) => isArrayLikeObj && parseInt(String(k)) >= 0),
        new PropertyGroup(formatProperties, `getter`, ([, v, d]) => v != null && isGetter(d)),
        new PropertyGroup(formatProperties, `array`, ([k, v]) => isArrayLike(v, receiver[k])),
        new PropertyGroup(formatProperties, `object`, ([, v]) => Boolean(v) && typeof v === `object`),
        new PropertyGroup(formatPropertyKeys, `function`, ([, v]) => typeof v === `function`),
        new PropertyGroup(formatPropertyKeys, `null`, ([, v]) => v === null),
        new PropertyGroup(formatPropertyKeys, `undefined`, ([, v]) => v === undefined),
        new PropertyGroup(formatPrototype, ``, () => false, () => true),
    ];
    // add array and iterable keys into Set, filter keys based on that
    keys.map(key => {
        try {
            return [key,
                Reflect.get(data, key, receiver),
                Reflect.getOwnPropertyDescriptor(data, key)
            ];
        } catch (error) {
            return [key, error.stack, undefined];
        }
    }).toSorted((a, b) => [
        [typeof a[0], typeof b[0]],
        [typeof a[1], typeof b[1]],
        [String(a[0]), String(b[0])],
    ].map(([lhs, rhs]) =>
        lhs !== rhs ? lhs > rhs ? 1 : -1 : 0
    ).find(Boolean) ?? 0).forEach(property => (
        groups.find(group => group.predicate(property)) ?? groups[0]
    ).properties.push(property));
    return `(${keys.length}){${indent}${groups.filter(
        group => group.validator()
    ).map(
        group => group.formatter()
    ).join(``)}${indentPrev}}${formatOrigin(
        data === receiver ? target.pathResolve() : name
    )}`;
}
function formatArrayLike() {
    return null; // array item name to array[index]
}
export function formatOrigin(str) {
    return `( ${str} )`;
}
export function formatAccess(key) {
    return typeof key === `symbol` ? formatSymbol(key) : key;
}
export function formatSymbol(sym) {
    const desc = sym.description;
    return `[${wellknown.includes(sym) ? desc : Boolean(desc) ? `Symbol("${desc}")` : `Symbol()`}]`;
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
export function isGetter(desc = {}) {
    return typeof desc.get === `function`;
}
export function formatDescriptor(desc = {}) {
    const descNotDefault = [
        [`C`, desc.configurable === false],
        [`E`, desc.enumerable === false],
        [`W`, desc.writable === false],
        [`G`, typeof desc.get === `function`],
        [`S`, typeof desc.set === `function`],
    ].filter(selectPredicate).map(([value]) => value).join(``);
    return Boolean(descNotDefault) ? `'${descNotDefault}` : ``;
}
export function selectPredicate(pair) {
    return pair[1];
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