'use strict';
export const knownSymbols = Reflect.ownKeys(Symbol).map(
    key => Symbol[key]
).filter(value => typeof value === `symbol`);
export const defaults = {
    newlineLimitArray: 40,
    newlineLimitGroup: 40,
    format: {
        prefix: `[`,
        suffix: `]`,
    },
    indent: {
        base: `|`,
        fill: ` `,
        size: 8,
    },
    type: {
        format: {
            ignore: true,
            modify: dataType,
            prefix: `<`,
            suffix: `>`,
        },
    },
    object: {
        format: {
            prefix: `{`,
            suffix: `}`,
        },
    },
    descriptor: {
        format: {
            prefix: `'`,
            suffix: ``,
        },
    },
    origin: {
        format: {
            prefix: `( `,
            suffix: ` )`,
        },
    },
    header: {
        format: {
            prefix: `# `,
            suffix: ``,
        },
        indent: {
            base: `|`,
            fill: `=`,
            size: 8,
        },
    },
    ptype: {
        format: {
            modify: dataType,
            prefix: `[[`,
            suffix: `]]`,
        },
        indent: {
            base: `|`,
            fill: `-`,
            size: 4,
        },
        exclude: [
            Object.prototype,
        ],
    },
    invokeAsync: {
        enabled: true,
        timeout: 10,
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
const optionsWithType = {
    ...defaults, type: {
        ...defaults.type, format: {
            ...defaults.type.format,
            ignore: false,
        },
    },
};
const optionsMemoized = new Set([defaults, optionsWithType]);
const mergeShallow = (src, obj) => ({ ...src, ...obj }); // deep merge function
export function optionsNormalize(arg) {
    return optionsMemoized.has(arg) ? arg : mergeShallow(defaults, arg);
}
export function log(...args) {
    logCustom(optionsWithType, ...args);
}
export function logCustom(options, ...args) {
    const opts = optionsNormalize(options);
    const header = `[${new URL(import.meta.url).pathname.slice(1)}]`;
    const spacer = `\n\n${`-`.repeat(31)}\n\n`;
    const indent = new Indentation();
    const expObj = new Map();
    const output = args.map((arg, num) => {
        try {
            const keys = isObj(arg) ? Reflect.ownKeys(arg) : [];
            const captured = keys.length === 1 && dataType(arg) === `Object`;
            const [name, data] = captured ? [keys[0], arg[keys[0]]] : [formatCustom(arg, opts.type), arg];
            const expand = format(new Target(data, name, [name], indent.next(opts)), opts, expObj);
            return `${spacer}[${num}]: ${captured ? `${format(name)} = ` : ``}${expand}`;
        } catch (error) {
            return `${spacer}[${num}]: ${format(error)}`;
        }
    }).join(``);
    console.log(header + output);
    // make objDone to Map, filter all entries above 1, print last
}
export function format(arg, options, expObj) {
    /*
        // _iterable: x => use Iterator.prototype.take, spread iterator,
        // create object with resulting array and receiver object and pass to formatObj
        // add function newline (newline low amount of function)
        // add function invocation
        // add date object output
    */
    const opts = optionsNormalize(options);
    const target = Target.normalize(arg);
    const { data } = target;
    const type = formatCustom(data, opts.type);
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
    ].find(selectTruthy)?.[0] ?? typeof data;
    const expand = ({
        filtered: () => filtered,
        function: () => formatCustom(data.name, opts),
        string: () => formatCustom(`"${data}"`, opts),
        symbol: () => formatSymbol(data, opts),
        object: () => formatObject(target, opts, expObj),
    })[dispatch]?.() ?? formatCustom(String(data), opts);
    return type + expand;
}
export function formatFiltered(target, options, expObj) { // move back to formatObject
    const opts = optionsNormalize(options);
    const { data, path, indent } = target;
    if (isObj(data) && Boolean(expObj)) {
        const { current, previous } = indent.resolve;
        const formatFilter = (prefix, suffix) => str => `{${prefix}${str}${suffix}}`;
        const formatOutput = formatFilter(current, previous);
        const formatSingle = formatFilter(``, ``);
        const isExcluded = arg => opts.ptype.exclude.some(obj => obj === arg);
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
    const opts = optionsNormalize(options);
    const { data, name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const keys = Reflect.ownKeys(data); // Set
    if (isArrayOnly(receiver, keys)) {
        return formatArray(target, opts, expObj);
    }
    const formatPropertyKeys = properties => {
        const newline = properties.length < opts.newlineLimitGroup;
        return properties.map(({ key, descr }) =>
            format(key) + formatDescriptor(descr, opts)
        ).join(newline ? current : `,`);
    };
    const formatProperties = properties => {
        const longest = (max, { key }) => max.length > key.length ? max : key;
        const pad = format(properties.reduce(longest, ``)).length;
        return properties.map(({ key, value, descr }, index) => {
            const expand = format(new Target(
                value, key, path.concat(keyStr(key)), indent.next(opts)
            ), opts, expObj);
            const multi = expand.includes(`\n`);
            const access = format(key).padEnd(multi ? 0 : pad);
            const spacer = index < properties.length - 1 && multi ? current : ``;
            return `${access} = ${expand}${formatDescriptor(descr, opts)}${spacer}`;
        }).join(current);
    };
    const formatPrototype = () => { // ptype/proto
        const objPtype = Object.getPrototypeOf(data);
        const strPtype = formatCustom(objPtype, opts.ptype);
        const indPtype = indent.with(-1, opts.ptype);
        const origin = keyStr(name);
        const access = formatCustom(`getPrototypeOf( ${origin} )`, opts);
        const expand = format(new Target(
            objPtype, `${origin}.${strPtype}`, path.concat(strPtype), indPtype.next(opts), receiver
        ), opts, expObj);
        return `${indPtype.resolve.current}${access} = ${expand}`;
    };
    const PropertyGroup = class { // maybe change constructor to use object destructure
        static #tag = indent.with(-1, opts.header).resolve.current;
        constructor(formatter, header, predicate = falseFn) {
            this.mutablePropertyList = [];
            this.predicate = predicate;
            this.expand = function() {
                if (!this.verify()) {
                    return ``;
                }
                const prepend = !header ? `` : `${PropertyGroup.#tag}${formatCustom(
                    header, opts.header
                )}(${this.mutablePropertyList.length})${current}`;
                return prepend + formatter(this.mutablePropertyList) + current;
            };
        }
        add(property) {
            this.mutablePropertyList.push(property);
        }
        verify() {
            return this.mutablePropertyList.length > 0;
        }
    };
    const PrototypeGroup = class extends PropertyGroup {
        constructor() {
            super(formatPrototype, ``);
        }
        add() {
            return;
        }
        verify() {
            return !opts.ptype.format.ignore;
        }
    };
    // Map key/descriptor
    const isGetterNonNullish = (v, descr) => v != null && isGetter(descr);
    const isArrayItem = (isParentArray =>
        ([key]) => isParentArray && parseInt(String(key)) >= 0
    )(isArrayLike(receiver));
    const groups = [
        new PropertyGroup(formatProperties, `primitive`),
        new PropertyGroup(formatProperties, `getter`, isGetterNonNullish),
        new PropertyGroup(formatProperties, `object`, isObj),
        new PropertyGroup(formatProperties, `array`, isArrayLike),
        new PropertyGroup(formatPropertyKeys, `function`, v => typeof v === `function`),
        new PropertyGroup(formatPropertyKeys, `null`, v => v === null),
        new PropertyGroup(formatPropertyKeys, `undefined`, v => v === undefined),
        new PrototypeGroup(),
    ];
    // add array and iterable keys into Set, filter keys based on that
    const keyToProperty = key => {
        try {
            return {
                key,
                value: Reflect.get(data, key, receiver),
                descr: Reflect.getOwnPropertyDescriptor(data, key),
            };
        } catch (error) {
            return { key, value: error, descr: undefined };
        }
    };
    const ternaryCmp = (a, b) => a === b ? 0 : a > b ? 1 : -1;
    const sortProperty = (lhs, rhs) => {
        const keyLHS = lhs.key;
        const keyRHS = rhs.key;
        const valueLHS = lhs.value;
        const valueRHS = rhs.value;
        return (
            ternaryCmp(typeof keyLHS, typeof keyRHS) ||
            ternaryCmp(isObj(valueLHS), isObj(valueRHS)) ||
            ternaryCmp(typeof valueLHS, typeof valueRHS) ||
            ternaryCmp(String(keyLHS), String(keyRHS))
        );
    };
    const selectGroup = ({ value, descr }, fallback) => groups.find(
        group => group.predicate(value, descr)
    ) ?? fallback;
    keys.map(keyToProperty).toSorted(sortProperty).forEach(
        property => selectGroup(property, groups[0]).add(property)
    );
    expObj.set(data, [path]);
    const expand = groups.map(group => group.expand()).join(``);
    const single = !expand.includes(`\n`);
    const prefix = single ? `` : current;
    const suffix = single ? `` : previous;
    const origin = single ? `` : formatCustom(data === receiver ? target.pathResolve() : name, opts.origin);
    return `(${keys.length})${formatCustom(prefix + expand + suffix, opts.object)}${origin}`;
}
export function formatArray(target, options, expObj) {
    const opts = optionsNormalize(options);
    const { name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const arr = Array.from(receiver);
    const newline = arr.length < opts.newlineLimitArray;
    const prefix = newline ? current : ` `;
    const append = newline ? `,${previous}` : ` `;
    const formatItem = (item, indexed) => format(new Target(
        item, indexed, path.concat(indexed), newline ? indent.next(opts) : indent
    ), opts, expObj);
    const expand = !arr.length ? `` : arr.map(
        (item, index) => prefix + formatItem(item, `${name}[${index}]`)
    ).join(`,`) + append;
    const origin = formatCustom(target.pathResolve(), opts.origin);
    return `(${arr.length})${formatCustom(expand, opts)}${origin}`;
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
    const msg = sym.description;
    const str = knownSymbols.includes(sym) ? msg : Boolean(msg) ? `Symbol("${msg}")` : `Symbol()`;
    return formatCustom(str, options);
}
export function formatDescriptor(descr = {}, options) {
    const descrModified = [
        [`W`, descr.writable === false],
        [`E`, descr.enumerable === false],
        [`C`, descr.configurable === false],
        [`G`, typeof descr.get === `function`],
        [`S`, typeof descr.set === `function`],
    ].filter(selectTruthy).map(([value]) => value).join(``);
    return !descrModified ? `` : formatCustom(descrModified, options.descriptor);
}
export function formatCustom(arg, { format: {
    ignore = false,
    modify = null,
    prefix = ``,
    suffix = ``,
} } = defaults) {
    return ignore ? `` : `${prefix}${modify?.(arg) ?? arg}${suffix}`;
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
export function falseFn() {
    return false;
}
export function partial(fn, ...partials) {
    return (...args) => fn(...partials, ...args);
};
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
            previous: this.#steps.slice(0, -1).join(``),
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
    static step({ indent: {
        base = ``,
        fill = ``,
        size = 0,
    } } = defaults) {
        return base.padEnd(size, fill);
    }
}