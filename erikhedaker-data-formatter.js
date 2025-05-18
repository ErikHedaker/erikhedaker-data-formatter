'use strict';
export const knownSymbols = Reflect.ownKeys(Symbol).map(
    key => Symbol[key]
).filter(value => typeof value === `symbol`);
export const defaultOptions = {
    addType: false,
    addDescriptor: true,
    newlineLimitArray: 40,
    newlineLimitGroup: 40,
    indentPad: ` `,
    indentStr: `|`,
    indentNum: 8,
    headerTag: {
        indentPad: `=`,
        indentStr: `|`,
        indentNum: 8,
        append: `# `,
    },
    ptype: {
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
    logCustom({ addType: true }, ...args);
}
export function logCustom(opt, ...args) {
    const options = normalizeOptions(opt);
    const header = `[${new URL(import.meta.url).pathname.slice(1)}]`;
    const spacer = `\n\n${`-`.repeat(31)}\n\n`;
    const indent = new Indentation();
    const expObj = new Map();
    console.log(`${header}${args.map((arg, num) => {
        try {
            const keys = arg && typeof arg === `object` ? Reflect.ownKeys(arg) : [];
            const captured = keys.length === 1 && valueType(arg) === `Object`;
            const [name, data] = captured ? [keys[0], arg[keys[0]]] : [`<${valueType(arg)}>`, arg];
            const expand = format(new Target(data, name, [name], indent.next(options)), options, expObj);
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
    const addType = isObj(opt) && opt.addType;
    const target = Target.normalize(arg);
    const { data, receiver } = target;
    const filtered = formatFiltered(target, opt, expObj);
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
        [`array`, isArrayOnly(receiver)], //move to formatObject
    ].find(selectTruthy)?.[0] ?? typeof data;
    return `${addType ? `<${valueType(data)}>` : ``}${({
        filtered: () => filtered,
        function: () => `[${data.name}]`,
        string: () => `["${data}"]`,
        symbol: () => formatSymbol(data),
        object: () => formatObject(target, opt, expObj),
        array: () => formatArray(target, opt, expObj),
    })[dispatch]?.() ?? `[${String(data)}]`}`;
}
export function formatFiltered(target, opt, expObj) {
    const { data, path, indent } = target;
    if (isObj(data) && Boolean(expObj)) {
        const options = normalizeOptions(opt);
        const { current, previous } = indent.resolve;
        const formatFilter = (prepend, append) => str => `{${prepend}${str}${append}}`;
        const formatOutput = formatFilter(current, previous);
        const formatSingle = formatFilter(``, ``);
        const isExcluded = arg => options.ptype.exclude.some(obj => obj === arg);
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
export function formatArray(target, opt, expObj) {
    const options = normalizeOptions(opt);
    const { name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const arr = Array.from(receiver);
    const newline = arr.length < options.newlineLimitArray;
    const delim = newline ? current : ` `;
    const added = newline ? previous : ` `;
    return !arr.length ? `(0)[]` : `(${arr.length})[${delim}${arr.map((item, index) => {
        const indexed = `${name}[${index}]`;
        return format(new Target(
            item, indexed, path.concat(indexed), newline ? indent.next(options) : indent
        ), options, expObj);
    }).join(`,${delim}`)}${added}]${formatEnding(target.pathResolve())}`;
}
export function formatObject(target, opt, expObj = new Map()) {
    //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
    //unroll iterator, filter keys if items contain keys from object
    const options = normalizeOptions(opt);
    const { data, name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const keys = Reflect.ownKeys(data); // Set
    expObj.set(data, [path]);
    const formatPropertyKeys = properties => {
        const newline = properties.length < options.newlineLimitGroup;
        return properties.map(([key, _, desc]) =>
            format(key) + formatDescriptor(desc)
        ).join(newline ? current : `,`);
    };
    const formatProperties = properties => {
        const longest = (max, [key]) => max.length > key.length ? max : key;
        const pad = format(properties.reduce(longest, ``)).length;
        return properties.map(([key, value, desc], index) => {
            const expand = format(new Target(
                value, key, path.concat(formatAccess(key)), indent.next(options)
            ), options, expObj);
            const isMultiline = expand.includes(`\n`);
            const spacer = index < properties.length - 1 && isMultiline ? current : ``;
            const access = format(key).padEnd(isMultiline ? 0 : pad);
            return `${access} = ${expand}${formatDescriptor(desc)}${spacer}`;
        }).join(current);
    };
    const formatPrototype = () => {
        const access = formatAccess(name);
        const objPtype = Object.getPrototypeOf(data);
        const strPtype = `[[${valueType(objPtype)}]]`;
        const indentPtype = indent.with(-1, Indentation.step(options.ptype));
        const expand = format(new Target(
            objPtype, `${access}.${strPtype}`, path.concat(strPtype), indentPtype.next(options), receiver
        ), options, expObj);
        return `${indentPtype.resolve.current}[getPrototypeOf( ${access} )] = ${expand}`;
    };
    const PropertyGroup = class {
        #tag = indent.with(-1, Indentation.step(options.headerTag)).resolve.current + options.headerTag.append;
        constructor(output, header, predicate, verify = function() {
            return this.properties.length !== 0;
        }) {
            this.properties = [];
            this.predicate = predicate;
            this.output = () => !verify.call(this) ? `` : (
                !header ? `` : `${`${this.#tag}${header}`}(${this.properties.length})${current}`
            ) + output(this.properties) + current;
        }
    };
    // Map key/descriptor
    const nonNullishGetter = (v, desc) => v != null && isGetter(desc);
    const isArrayItem = (isParentArray =>
        ([key]) => isParentArray && parseInt(String(key)) >= 0
    )(isArrayLike(receiver));
    const groups = [
        new PropertyGroup(formatProperties, `primitive`, () => false),
        new PropertyGroup(formatProperties, `getter`, nonNullishGetter),
        new PropertyGroup(formatProperties, `array-item`, () => false),
        new PropertyGroup(formatProperties, `object`, v => isObj(v)),
        new PropertyGroup(formatProperties, `array`, v => isArrayLike(v)),
        new PropertyGroup(formatPropertyKeys, `function`, v => typeof v === `function`),
        new PropertyGroup(formatPropertyKeys, `null`, v => v === null),
        new PropertyGroup(formatPropertyKeys, `undefined`, v => v === undefined),
        new PropertyGroup(formatPrototype, ``, () => false, () => true),
    ];
    // add array and iterable keys into Set, filter keys based on that
    const ternaryCmp = (a, b) => a === b ? 0 : a > b ? 1 : -1;
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
        ternaryCmp(isObj(lhs[1]), isObj(rhs[1])) ||
        ternaryCmp(typeof lhs[1], typeof rhs[1]) ||
        ternaryCmp(String(lhs[0]), String(rhs[0]))
    ).forEach(property => (
        groups.find(group =>
            group.predicate(property[1], property[2])
        ) ?? groups[0]
    ).properties.push(property));
    const output = groups.map(group => group.output()).join(``);
    const ending = formatEnding(data === receiver ? target.pathResolve() : name);
    return `(${keys.length}){${current}${output}${previous}}${ending}`;
}
export function formatArrayLike() {
    return null; // array item name to array[index]
}
export function formatEnding(str) {
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
        [`W`, desc.writable === false],
        [`E`, desc.enumerable === false],
        [`C`, desc.configurable === false],
        [`G`, typeof desc.get === `function`],
        [`S`, typeof desc.set === `function`],
    ].filter(selectTruthy).map(([value]) => value).join(``);
    return Boolean(descNotDefault) ? `'${descNotDefault}` : ``;
}
export function valueType(arg) {
    return isObj(arg) ? Object.prototype.toString.call(arg).slice(8, -1) : typeof arg;
}
export function isArrayOnly(arg) {
    return isArrayLike(arg) && arg.length === Reflect.ownKeys(arg).length - 1;
}
export function isArrayLike(arg) {
    return isObj(arg) && Number.isInteger(arg.length) && arg.length >= 0;
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
    #name;
    #path;
    #indent;
    #receiver;
    constructor(data, name, path, indent, receiver) {
        this.data = data;
        this.#name = name;
        this.#path = path;
        this.#indent = indent;
        this.#receiver = receiver;
    }

    get name() {
        return this.#name ?? valueType(this.data);
    }
    get path() {
        return this.#path ?? [this.name];
    }
    get indent() {
        return this.#indent ?? new Indentation().next();
    }
    get receiver() {
        return this.#receiver ?? this.data;
    }

    set name(arg) {
        this.#indent = arg;
    }
    set path(arg) {
        this.#indent = arg;
    }
    set indent(arg) {
        this.#indent = arg;
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
    #steps;
    constructor(steps = [`\n`]) {
        this.#steps = steps;
    }
    get resolve() {
        return {
            current: this.#steps.join(``),
            previous: this.#steps.slice(0, -1).join(``)
        };
    }
    with(index, value) {
        return new Indentation(
            this.#steps.with(index, value)
        );
    }
    next(options) {
        return new Indentation(
            this.#steps.concat(Indentation.step(options))
        );
    }
    static step({ indentPad, indentStr, indentNum } = defaultOptions) {
        return indentStr.padEnd(indentNum, indentPad);
    }
}