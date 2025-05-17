'use strict';
const knownSymbols = Reflect.ownKeys(Symbol).map(
    key => Symbol[key]
).filter(value => typeof value === `symbol`);
const defaultOptions = {
    attachType: false,
    newlineLimitArray: 40,
    newlineLimitGroup: 40,
    indentPad: ` `,
    indentAdd: `|`,
    indentNum: 6,
    prototype: {
        indentPad: ` `,
        indentAdd: `|`,
        indentNum: 3,
        exclude: [
            Object.prototype
        ],
    },
    invokeAsync: {
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
export function normalizeOptions(arg) {
    return arg !== defaultOptions && isObj(arg) ? ({ ...defaultOptions, ...arg }) : defaultOptions;
}
export function log(...args) {
    logCustom({ attachType: true }, ...args);
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
export function format(arg, opt, expObj) {
    /*
        // _iterable: x => use Iterator.prototype.take, spread iterator,
        // create object with resulting array and receiver object and pass to formatObj
        // add function newline (newline low amount of function)
        // add function invocation
        // add date object output
    */
    const options = normalizeOptions(opt);
    const target = Target.normalize(arg);
    const { data, receiver } = target;
    const filtered = formatFiltered(target, options, expObj);
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
    ].find(selectTruthy)?.[0] ?? typeof data;
    return `${options.attachType ? `<${valueType(data)}>` : ``}${({
        filtered: () => filtered,
        function: () => `[${data.name}]`,
        string: () => `["${data}"]`,
        symbol: () => formatSymbol(data),
        object: () => formatObject(target, options, expObj),
        array: () => formatArray(target, options, expObj),
    })[dispatch]?.() ?? `[${String(data)}]`}`;
}
function formatFiltered(target, options, expObj) {
    const { data, path } = target;
    if (isObj(data)) {
        const [indent, indentPrev] = indentNext(target, options);
        const formatFilter = (prepend, append) => str => `{${prepend}${str}${append}}`;
        const formatOutput = formatFilter(indent, indentPrev);
        const formatSingle = formatFilter(``, ``);
        const isExcluded = arg => options.prototype.exclude.some(obj => obj === arg);
        const objEmpty = Reflect.ownKeys(data).length === 0;
        const objPtype = Object.getPrototypeOf(data);
        const expValue = expObj.get(data);
        const expPtype = expObj.get(objPtype);
        if (isExcluded(data)) {
            return formatSingle(`is-filtered`);
        }
        if (isExcluded(objPtype) && objEmpty) {
            return formatSingle(`is-filtered`);
        }
        if (Boolean(expValue)) {
            expValue.push(path);
            return formatOutput(`is-copy-of-( ${expValue[0].join(`.`)} )`);
        }
        if (Boolean(expPtype) && objEmpty) {
            expPtype.push(path);
            return formatOutput(`is-copy-of-( ${expPtype[0].join(`.`)} )`);
        }
    }
    return null;
}
function formatIterable(target, options, expObj) {
    const { data } = target;
    const size = parseInt(data.size) || parseInt(data.length) || 20;
    const iter = data[Symbol.iterator];
}
function formatArray(target, options, expObj) {
    const [indent, indentPrev] = indentNext(target, options);
    const { name, path, receiver } = target;
    const arr = Array.from(receiver);
    const newline = arr.length < options.newlineLimitArray;
    const str = (delim, add) => `(${arr.length})[${delim}${arr.map((item, index) => {
        const indexed = `${name}[${index}]`;
        return format(new Target(
            item, indexed, path.concat(indexed), newline ? indent : indentPrev
        ), options, expObj);
    }).join(`,${delim}`)}${add}]${formatOrigin(target.pathResolve())}`;
    return !arr.length ? `(0)[]` : newline ? str(indent, indentPrev) : str(` `, ` `);
}
function formatObject(target, options, expObj = new Map()) {
    //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
    //unroll iterator, filter keys if items contain keys from object
    const [indent, indentPrev] = indentNext(target, options);
    const { data, name, receiver, path } = target;
    const keys = Reflect.ownKeys(data);
    expObj.set(data, [path]);
    const formatPropertyKeys = properties => {
        const newline = properties.length < options.newlineLimitGroup;
        return properties.map(([key, _, desc]) =>
            format(key) + formatDescriptor(desc)
        ).join(newline ? indent : `,`) + indent;
    };
    const formatProperties = properties => {
        const longest = (max, [key]) => max.length > key.length ? max : key;
        const pad = format(properties.reduce(longest, ``)).length;
        return properties.map(([key, value, desc]) => `${format(key).padEnd(pad)} = ${format(
            new Target(value, key, path.concat(formatAccess(key)), indent), options, expObj
        )}${formatDescriptor(desc)}${indent}`).join(``);
    };
    const formatPrototype = () => {
        const [indentPtype] = indentNext(target, options.prototype);
        const [indentStray] = indentNext(target, { ...options.prototype, indentPad: `-` });
        const objPtype = Object.getPrototypeOf(data);
        const strPtype = `[[${valueType(objPtype)}]]`;
        const access = formatAccess(name);
        return `${indentStray}[getPrototypeOf( ${access} )] = ${format(new Target(
            objPtype, `${access}.${strPtype}`, path.concat(strPtype), indentPtype, receiver
        ), options, expObj)}${indent}`;
    };
    const PropertyGroup = class {
        constructor(formatter, header, predicate, validator = function() {
            return this.properties.length !== 0;
        }) {
            this.properties = [];
            this.formatter = () => (!header ? `` :
                `${indentPrev}${options.indentAdd}${`-#`.padStart(
                    options.indentNum, `-`
                )} ${header}(${this.properties.length})${indent}`
            ) + formatter(this.properties);
            this.predicate = predicate;
            this.validator = validator;
        }
    };
    const isArrayItem = (isParentArray =>
        ([key]) => isParentArray && parseInt(String(key)) >= 0
    )(isArrayLike(data, receiver));
    const groups = [
        new PropertyGroup(formatProperties, `primitive`, () => false),
        new PropertyGroup(formatProperties, `getter`, ([, v, desc]) => v != null && isGetter(desc)),
        new PropertyGroup(formatProperties, `array-item`, isArrayItem),
        new PropertyGroup(formatProperties, `object`, ([, v]) => isObj(v)),
        new PropertyGroup(formatProperties, `array`, ([k, v]) => isArrayLike(v, receiver[k])),
        new PropertyGroup(formatPropertyKeys, `function`, ([, v]) => typeof v === `function`),
        new PropertyGroup(formatPropertyKeys, `null`, ([, v]) => v === null),
        new PropertyGroup(formatPropertyKeys, `undefined`, ([, v]) => v === undefined),
        new PropertyGroup(formatPrototype, ``, () => false, () => true),
    ];
    // add array and iterable keys into Set, filter keys based on that
    const triCompare = (lhs, rhs) => lhs !== rhs ? lhs > rhs ? 1 : -1 : 0;
    keys.map(key => {
        try {
            return [key,
                Reflect.get(data, key, receiver),
                Reflect.getOwnPropertyDescriptor(data, key)
            ];
        } catch (error) {
            return [key, error.stack];
        }
    }).toSorted((lhs, rhs) =>
        triCompare(typeof lhs[0], typeof rhs[0]) ||
        triCompare(typeof lhs[1], typeof rhs[1]) ||
        triCompare(String(lhs[0]), String(rhs[0]))
    ).forEach(property => (
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
    return `[${knownSymbols.includes(sym) ? desc : Boolean(desc) ? `Symbol("${desc}")` : `Symbol()`}]`;
}
export function valueType(arg) {
    return isObj(arg) ? Object.prototype.toString.call(arg).slice(8, -1) : typeof arg;
}
export function indentNext({ indent = `\n` } = {}, {
    indentPad, indentAdd, indentNum
} = defaultOptions) {
    return [indent + indentAdd.padEnd(indentNum, indentPad), indent];
}
export function isObj(arg) {
    return Boolean(arg) && typeof arg === `object`;
}
export function isIterable(arg) {
    return isObj(arg) && typeof arg[Symbol.iterator] === `function`;
}
export function isArrayLikeOnly(arg, receiver) {
    const access = receiver ?? arg;
    return isArrayLike(arg, receiver) && access.length === Reflect.ownKeys(arg).length - 1;
}
export function isArrayLike(arg, receiver) {
    const access = receiver ?? arg;
    return isObj(arg) && Number.isInteger(access.length) && access.length >= 0;
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
    ].filter(selectTruthy).map(([value]) => value).join(``);
    return Boolean(descNotDefault) ? `'${descNotDefault}` : ``;
}
export function selectTruthy(pair) {
    return Boolean(pair[1]);
}
export function templateBreak({ raw }, ...args) {
    return String.raw({ raw: raw.map(str => str.replace(/\n\s*/g, ``).replace(/\\n/g, `\n`)) }, ...args);
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