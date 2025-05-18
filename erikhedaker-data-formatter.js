'use strict';
export const knownSymbols = Reflect.ownKeys(Symbol).map(
    key => Symbol[key]
).filter(value => typeof value === `symbol`);
export const defaultOptions = {
    attachType: false,
    newlineLimitArray: 40,
    newlineLimitGroup: 40,
    indentPad: ` `,
    indentStr: `|`,
    indentNum: 8,
    prototypeOpt: {
        indentPad: `-`,
        indentStr: `|`,
        indentNum: 4,
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
    const header = `[${new URL(import.meta.url).pathname.slice(1)}]`;
    const spacer = `\n\n${`-`.repeat(31)}\n\n`;
    const expObj = new Map();
    console.log(`${header}${args.map((arg, num) => {
        try {
            const keys = arg && typeof arg === `object` ? Reflect.ownKeys(arg) : [];
            const captured = keys.length === 1 && valueType(arg) === `Object`;
            const [name, data] = captured ? [keys[0], arg[keys[0]]] : [`<${valueType(arg)}>`, arg];
            const expand = format(new Target(data, name, [name], Indentation.initiate()), options, expObj);
            return `${spacer}[${num}]: ${captured ? `${format(name)} = ` : ``}${expand}`;
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
        [`array`, isArrayOnly(data, receiver)],
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
export function formatFiltered(target, options, expObj) {
    const { data, path, indent } = target;
    if (isObj(data)) {
        const [current, previous] = indent.resolve;
        const formatFilter = (prepend, append) => str => `{${prepend}${str}${append}}`;
        const formatOutput = formatFilter(current, previous);
        const formatSingle = formatFilter(``, ``);
        const isExcluded = arg => options.prototypeOpt.exclude.some(obj => obj === arg);
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
export function formatIterable(target, options, expObj) {
    const { data } = target;
    const size = parseInt(data.size) || parseInt(data.length) || 20;
    const iter = data[Symbol.iterator];
}
export function formatArray(target, options, expObj) {
    const { name, path, indent, receiver } = target;
    const [current, previous] = indent.resolve;
    const arr = Array.from(receiver);
    const newline = arr.length < options.newlineLimitArray;
    const str = (delim, add) => `(${arr.length})[${delim}${arr.map((item, index) => {
        const indexed = `${name}[${index}]`;
        return format(new Target(
            item, indexed, path.concat(indexed), newline ? indent.next() : indent
        ), options, expObj);
    }).join(`,${delim}`)}${add}]${formatOrigin(target.pathResolve())}`;
    return !arr.length ? `(0)[]` : newline ? str(current, previous) : str(` `, ` `);
}
export function formatObject(target, options, expObj = new Map()) {
    //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
    //unroll iterator, filter keys if items contain keys from object
    const { data, name, path, indent, receiver } = target;
    const [current, previous] = indent.resolve;
    const keys = Reflect.ownKeys(data);
    expObj.set(data, [path]);
    const formatPropertyKeys = properties => {
        const newline = properties.length < options.newlineLimitGroup;
        return properties.map(([key, _, desc]) =>
            format(key) + formatDescriptor(desc)
        ).join(newline ? current : `,`) + current;
    };
    const formatProperties = properties => {
        const longest = (max, [key]) => max.length > key.length ? max : key;
        const pad = format(properties.reduce(longest, ``)).length;
        return properties.map(([key, value, desc]) => {
            const access = format(key).padEnd(pad);
            const expand = format(new Target(
                value, key, path.concat(formatAccess(key)), indent.next()
            ), options, expObj);
            return `${access} = ${expand}${formatDescriptor(desc)}${current}`;
        }).join(``);
    };
    const formatPrototype = () => {
        const indentPtype = indent.with(-1, Indentation.step(options.prototypeOpt)).next();
        const [currentPtype, previousPtype] = indentPtype.resolve;
        const objPtype = Object.getPrototypeOf(data);
        const strPtype = `[[${valueType(objPtype)}]]`;
        const access = formatAccess(name);
        return `${previousPtype}[getPrototypeOf( ${access} )] = ${format(new Target(
            objPtype, `${access}.${strPtype}`, path.concat(strPtype), indentPtype, receiver
        ), options, expObj)}`;
    };
    const PropertyGroup = class {
        #tag = indent.with(-1, Indentation.step({ ...options, indentPad: `=` })).resolve[0];
        constructor(formatter, header, predicate, validator = function() {
            return this.properties.length !== 0;
        }) {
            this.properties = [];
            this.header = () => header ? `${`${this.#tag}# ${header}`}(${this.properties.length})${current}` : ``;
            this.formatter = () => this.header() + formatter(this.properties);
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
    const ternaryCmp = (lhs, rhs) => lhs !== rhs ? lhs > rhs ? 1 : -1 : 0;
    keys.map(key => {
        try {
            return [key,
                Reflect.get(data, key, receiver),
                Reflect.getOwnPropertyDescriptor(data, key)
            ];
        } catch (error) {
            return [key, error];
        }
    }).toSorted((lhs, rhs) =>
        ternaryCmp(typeof lhs[0], typeof rhs[0]) ||
        ternaryCmp(typeof lhs[1], typeof rhs[1]) ||
        ternaryCmp(String(lhs[0]), String(rhs[0]))
    ).forEach(property => (
        groups.find(group => group.predicate(property)) ?? groups[0]
    ).properties.push(property));
    return `(${keys.length}){${current}${groups.filter(
        group => group.validator()
    ).map(
        group => group.formatter() + current
    ).join(``)}${previous}}${formatOrigin(
        data === receiver ? target.pathResolve() : name
    )}`;
}
export function formatArrayLike() {
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
export function valueType(arg) {
    return isObj(arg) ? Object.prototype.toString.call(arg).slice(8, -1) : typeof arg;
}
export function isArrayOnly(arg, receiver) {
    const access = receiver ?? arg;
    return isArrayLike(arg, receiver) && access.length === Reflect.ownKeys(arg).length - 1;
}
export function isArrayLike(arg, receiver) {
    const access = receiver ?? arg;
    return isObj(arg) && Number.isInteger(access.length) && access.length >= 0;
}
export function isIterable(arg) {
    return isObj(arg) && typeof arg[Symbol.iterator] === `function`;
}
export function isObj(arg) {
    return Boolean(arg) && typeof arg === `object`;
}
export function isGetter(desc = {}) {
    return typeof desc.get === `function`;
}
export function selectTruthy(pair) {
    return Boolean(pair[1]);
}
export function newlineTag({ raw }, ...args) {
    return String.raw({ raw: raw.map(str => str.replace(/\n\s*/g, ``).replace(/\\n/g, `\n`)) }, ...args);
}
export class Target {
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
        return isArrayLike(this.path) ? this.path.join(`.`) : this.name;
    }
    static normalize(arg) {
        return arg instanceof this ? arg : new this(arg);
    }
}
export class Indentation {
    constructor(steps, options) {
        this.steps = steps;
        this.options = options;
    }
    get previous() {
        return this.steps.slice(0, -1);
    }
    get resolve() {
        return [this.steps.join(``), this.previous.join(``)];
    }
    with(index, value, options) {
        const steps = this.steps.with(index, value);
        return new Indentation(steps, options ?? this.options);
    }
    next(options) {
        return Indentation.initiate(this.steps, options ?? this.options);
    }
    static initiate(arg, options) {
        return new Indentation(Indentation.iterate(arg, options), options);
    }
    static iterate(arg, options) {
        const steps = isArrayLike(arg) && arg.length > 0 ? arg : [`\n`];
        return steps.concat(Indentation.step(options));
    }
    static step({ indentPad, indentStr, indentNum } = defaultOptions) {
        return indentStr.padEnd(indentNum, indentPad);
    }
}