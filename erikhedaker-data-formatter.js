'use strict';
export const knownSymbols = Reflect.ownKeys(Symbol).map(
    key => Symbol[key]
).filter(value => typeof value === `symbol`);
export const defaults = {
    newlineLimitArray: 40,
    newlineLimitGroup: 40,

    dataPrefix: `[`,
    dataSuffix: `]`,

    indentPad: ` `,
    indentStr: `|`,
    indentNum: 8,

    type: {
        dataPrefix: `<`,
        dataSuffix: `>`,
        dataFn: dataType,
        dataDisable: true,
    },

    object: {
        dataPrefix: `{`,
        dataSuffix: `}`,
    },

    descriptor: {
        dataPrefix: `'`,
        dataSuffix: ``,
    },

    origin: {
        dataPrefix: `( `,
        dataSuffix: ` )`,
    },

    header: {
        dataPrefix: `# `,
        dataSuffix: ``,

        indentPad: `=`,
        indentStr: `|`,
        indentNum: 8,
    },

    ptype: {
        dataPrefix: `[[`,
        dataSuffix: `]]`,
        dataFn: dataType,

        indentPad: `-`,
        indentStr: `|`,
        indentNum: 4,

        exclude: [
            Object.prototype,
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
    return arg !== defaults && isObj(arg) ? ({ ...defaults, ...arg }) : defaults;
}
export function log(...args) {
    const outputOnlyValueType = { type: { ...defaults.type, dataDisable: false } };
    logCustom(outputOnlyValueType, ...args);
}
export function logCustom(opt, ...args) {
    const options = normalizeOptions(opt);
    const header = `[${new URL(import.meta.url).pathname.slice(1)}]`;
    const spacer = `\n\n${`-`.repeat(31)}\n\n`;
    const indent = new Indentation();
    const expObj = new Map();
    const output = args.map((arg, num) => {
        try {
            const keys = isObj(arg) ? Reflect.ownKeys(arg) : [];
            const captured = keys.length === 1 && dataType(arg) === `Object`;
            const [name, data] = captured ? [keys[0], arg[keys[0]]] : [formatData(arg, options.type), arg];
            const expand = format(new Target(data, name, [name], indent.next(options)), options, expObj);
            return `${spacer}[${num}]: ${captured ? `${format(name)} = ` : ``}${expand}`;
        } catch (error) {
            return `${spacer}[${num}]: ${format(error)}`;
        }
    }).join(``);
    console.log(header + output);
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
    const { data } = target;
    const type = formatData(data, options.type);
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
    ].find(selectTruthy)?.[0] ?? typeof data;
    const expand = ({
        filtered: () => filtered,
        function: () => formatData(data.name, options),
        string: () => formatData(`"${data}"`, options),
        symbol: () => formatSymbol(data, options),
        object: () => formatObject(target, options, expObj),
    })[dispatch]?.() ?? formatData(String(data), options);
    return type + expand;
}
export function formatFiltered(target, options, expObj) { // move back to formatObject
    const { data, path, indent } = target;
    if (isObj(data) && Boolean(expObj)) {
        const { current, previous } = indent.resolve;
        const formatFilter = (prefix, suffix) => str => `{${prefix}${str}${suffix}}`;
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
export function formatObject(target, options, expObj = new Map()) {
    //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
    //unroll iterator, filter keys if items contain keys from object
    const { data, name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const keys = Reflect.ownKeys(data); // Set
    if (isArrayOnly(receiver, keys)) {
        return formatArray(target, options, expObj);
    }
    const formatPropertyKeys = properties => {
        const newline = properties.length < options.newlineLimitGroup;
        return properties.map(({ key, desc }) =>
            format(key) + formatDescriptor(desc)
        ).join(newline ? current : `,`);
    };
    const formatProperties = properties => {
        const longest = (max, { key }) => max.length > key.length ? max : key;
        const pad = format(properties.reduce(longest, ``)).length;
        return properties.map(({ key, value, desc }, index) => {
            const expand = format(new Target(
                value, key, path.concat(keyStr(key)), indent.next(options)
            ), options, expObj);
            const multi = expand.includes(`\n`);
            const access = format(key).padEnd(multi ? 0 : pad);
            const spacer = index < properties.length - 1 && multi ? current : ``;
            return `${access} = ${expand}${formatDescriptor(desc)}${spacer}`;
        }).join(current);
    };
    const formatPrototype = () => { // ptype/proto
        const objPtype = Object.getPrototypeOf(data);
        const strPtype = formatData(objPtype, options.ptype);
        const indPtype = indent.with(-1, options.ptype);
        const origin = keyStr(name);
        const access = formatData(`getPrototypeOf( ${origin} )`, options);
        const expand = format(new Target(
            objPtype, `${origin}.${strPtype}`, path.concat(strPtype), indPtype.next(options), receiver
        ), options, expObj);
        return `${indPtype.resolve.current}${access} = ${expand}`;
    };
    const PropertyGroup = class {
        static #tag = indent.with(-1, options.header).resolve.current;
        constructor(formatter, header, predicate, verify = function() {
            return this.mutablePropertyList.length > 0;
        }) {
            this.mutablePropertyList = [];
            this.predicate = predicate;
            this.output = () => !verify.call(this) ? `` : (!header ? `` :
                `${PropertyGroup.#tag}${formatData(header, options.header)}(${this.mutablePropertyList.length})${current}`
            ) + formatter(this.mutablePropertyList) + current;
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
        new PropertyGroup(formatPrototype, ``, () => false, () => !options.ptype.dataDisable),
    ];
    // add array and iterable keys into Set, filter keys based on that
    const ternaryCmp = (a, b) => a === b ? 0 : a > b ? 1 : -1;
    keys.map(key => {
        try {
            return {
                key,
                value: Reflect.get(data, key, receiver),
                descr: Reflect.getOwnPropertyDescriptor(data, key)
            };
        } catch (error) {
            return { key, value: error };
        }
    }).toSorted((lhs, rhs) => {
        const valueLHS = lhs.value;
        const valueRHS = rhs.value;
        return ternaryCmp(typeof lhs.key, typeof rhs.key) ||
            ternaryCmp(isObj(valueLHS), isObj(valueRHS)) ||
            ternaryCmp(typeof valueLHS, typeof valueRHS) ||
            ternaryCmp(String(valueLHS), String(valueRHS));
    }).forEach(property => {
        const { value, descr } = property;
        const primitive = groups[0];
        const target = groups.find(
            group => group.predicate(value, descr)
        ) ?? primitive;
        target.mutablePropertyList.push(property);
    });
    expObj.set(data, [path]);
    const output = groups.map(group => group.output()).join(``);
    const single = !output.includes(`\n`);
    const prefix = single ? `` : current;
    const suffix = single ? `` : previous;
    const origin = single ? `` : formatData(data === receiver ? target.pathResolve() : name, options.origin);
    return `(${keys.length})${formatData(prefix + output + suffix, options.object)}${origin}`;
}
export function formatArray(target, options, expObj) {
    const { name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const arr = Array.from(receiver);
    const newline = arr.length < options.newlineLimitArray;
    const prefix = newline ? current : ` `;
    const append = newline ? `,${previous}` : ` `;
    const formatItem = (item, indexed) => format(new Target(
        item, indexed, path.concat(indexed), newline ? indent.next(options) : indent
    ), options, expObj);
    const expand = !arr.length ? `` : arr.map(
        (item, index) => prefix + formatItem(item, `${name}[${index}]`)
    ).join(`,`) + append;
    const origin = formatData(target.pathResolve(), options.origin);
    return `(${arr.length})${formatData(expand, options)}${origin}`;
}
export function formatIterable(target, options, expObj) {
    const { data } = target;
    const size = parseInt(data.size) || parseInt(data.length) || 20;
    const iter = data[Symbol.iterator];
}
export function formatArrayLike() {
    return null; // array item name to array[index]
}
export function keyStr(key, options) {
    return typeof key === `symbol` ? formatSymbol(key, options) : key;
}
export function formatSymbol(sym, options) {
    const dsc = sym.description;
    const str = knownSymbols.includes(sym) ? dsc : Boolean(dsc) ? `Symbol("${dsc}")` : `Symbol()`;
    return formatData(str, options);
}
export function formatDescriptor(desc = {}, options = defaults.descriptor) {
    const descriptorNonDefault = [
        [`W`, desc.writable === false],
        [`E`, desc.enumerable === false],
        [`C`, desc.configurable === false],
        [`G`, typeof desc.get === `function`],
        [`S`, typeof desc.set === `function`],
    ].filter(selectTruthy).map(([value]) => value).join(``);
    return !descriptorNonDefault ? `` : formatData(descriptorNonDefault, options);
}
export function formatData(data, {
    dataPrefix,
    dataSuffix,
    dataDisable,
    dataFn,
} = defaults) {
    return dataDisable ? `` : `${dataPrefix}${dataFn?.(data) ?? data}${dataSuffix}`;
}
export function dataType(arg) {
    return isObj(arg) ? Object.prototype.toString.call(arg).slice(8, -1) : typeof arg;
}
export function selectTruthy(pair) {
    return Boolean(pair[1]);
}
export function isArrayOnly(arg, keys) {
    return arg instanceof Array && isArrayMinimal(arg, keys);
}
export function isArrayMinimal(arg, keys) {
    return isArrayLike(arg) && arg.length === (keys?.length ?? Reflect.ownKeys(arg).length) - 1;
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
export function newlineTag({ raw }, ...args) {
    return String.raw({ raw: raw.map(str => str.replace(/\n\s*/g, ``).replace(/\\n/g, `\n`)) }, ...args);
}
export class Target { // Overhaul to Metadata class / Context / State / TraversalState & state
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
        return this.#name ?? dataType(this.data);
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
        this.#name = arg;
    }
    set path(arg) {
        this.#path = arg;
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
    with(index, options) {
        return new Indentation(
            this.#steps.with(index, Indentation.step(options))
        );
    }
    next(options) {
        return new Indentation(
            this.#steps.concat(Indentation.step(options))
        );
    }
    static step({ indentStr, indentNum, indentPad } = defaults) {
        return indentStr.padEnd(indentNum, indentPad);
    }
}