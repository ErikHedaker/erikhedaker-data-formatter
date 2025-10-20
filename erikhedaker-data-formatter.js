'use strict';

//-----#
//-----# Format.Memoization
//-----#

const defaults = createDefaultOptions();

function formatCustom(arg, { format: {
    ignore = false,
    modify = null,
    prefix = ``,
    suffix = ``,
} } = defaults) {
    return ignore ? `` : `${prefix}${modify?.(arg) ?? arg}${suffix}`;
}

export const knownSymbols = Reflect.ownKeys(Symbol).map(
    key => Symbol[key]
).filter(value => typeof value === `symbol`);

function formatSymbol(sym, options) {
    const msg = sym.description;
    const str = knownSymbols.includes(sym) ? msg : (Boolean(msg) ? `Symbol("${msg}")` : `Symbol()`);
    return formatCustom(str, options);
}

export const format = (() => {
    const extractTypeSelector = precomputeDispatchTable([
        [(target) => target.data === null, () => `null`],
        [(target) => target.data instanceof Date, () => `date`],
        [(target) => target.data instanceof Error, () => `error`],
    ], (target) => typeof target.data);
    const extractFormatter = precomputeDispatchTable([
        [(str) => str === `function`, (target, opts) => formatCustom(target.data.name, opts)],
        [(str) => str === `string`, (target, opts) => formatCustom(`"${target.data}"`, opts)],
        [(str) => str === `symbol`, (target, opts) => formatSymbol(target.data, opts)],
        [(str) => str === `object`, (target, opts) => formatObject(target, opts)],
    ], (target, opts) => formatCustom(String(target.data), opts));
    return (arg, options) => {
        const opts = normalizeOptions(options);
        const target = Target.normalize(arg);
        const selector = extractTypeSelector(target)(target);
        const expanded = extractFormatter(selector)(target, opts);
        const type = formatCustom(target.data, opts.type);
        return type + expanded;
    };
})();

function precomputeDispatchTable(pairs, fallback = () => undefined) {
    const truthy = (arg) => ({ predicate }) => predicate(arg);
    const field = ([predicate, extractor]) => ({ predicate, extractor });
    const table = pairs.map(field);
    return (arg) => table.find(truthy(arg))?.extractor ?? fallback;
};

const cyclicRefDict = new Map();
function formatObject(target, options) {
    //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
    //unroll iterator, filter keys if items contain keys from object
    const opts = normalizeOptions(options);
    const { data, name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const keys = Reflect.ownKeys(data); // Set // add array and iterable keys into Set, filter keys based on that
    const length = keys.length;
    const prtype = Object.getPrototypeOf(data);
    const prtypeRef = cyclicRefDict.get(prtype);
    const objRef = cyclicRefDict.get(data);
    const isExcluded = arg => opts.prtype.exclude.some(obj => obj === arg);
    const filtered = () => formatCustom(`is-filtered`, opts.object);
    const formatCopyOf = ([path]) => ( // better name
        str => formatCustom(current + str + previous, opts.object)
    )(`is-copy-of-( ${path.join(`.`)} )`);
    const copyOf = paths => () => (paths.push(path), formatCopyOf(paths)); // better name
    const formatEarlyReturn = [
        [filtered, isExcluded(data)],
        [filtered, isExcluded(prtype) && !length],
        [copyOf(objRef), Boolean(objRef)],
        [copyOf(prtypeRef), Boolean(prtypeRef) && !length],
        [() => formatArray(target, opts), isArrayOnly(receiver, length)],
    ].find(([, predicate]) => predicate)?.[0];
    if (Boolean(formatEarlyReturn)) {
        return formatEarlyReturn();
    }
    /*
    const isArrayItem = (isParentArray =>
        ([key]) => isParentArray && parseInt(String(key)) >= 0
    )(isArrayLike(receiver));
    */
    const {
        GroupPropertyEntry,
        GroupPropertyKey,
        GroupIterator,
        GroupPrototype,
    } = createObjectGroups(target, options);
    const groups = [ // IMPLEMENT WITH FACTORY PATTERN
        new GroupPropertyEntry(`primitive`),
        new GroupPropertyEntry(`getter`, ({ value, descr }) => value != null && isGetter(descr)),
        new GroupIterator(),
        new GroupPropertyEntry(`object`, ({ value }) => isObj(value)),
        new GroupPropertyEntry(`array`, ({ value }) => isArrayLike(value)),
        new GroupPropertyKey(`function`, ({ value }) => typeof value === `function`),
        new GroupPropertyKey(`null`, ({ value }) => value === null),
        new GroupPropertyKey(`undefined`, ({ value }) => value === undefined),
        new GroupPrototype(),
    ];
    const ternaryCmp = (a, b) => a === b ? 0 : a > b ? 1 : -1;
    const selectGroup = (fallback => property => groups.find(
        group => group.predicate(property)
    ) ?? fallback)(groups[0]);
    cyclicRefDict.set(data, [path]);
    keys.map(key => {
        try {
            return {
                key,
                value: Reflect.get(data, key, receiver),
                descr: Reflect.getOwnPropertyDescriptor(data, key),
            };
        } catch (error) {
            return { key, value: error, descr: undefined };
        }
    }).toSorted((lhs, rhs) =>
        ternaryCmp(typeof lhs.key, typeof rhs.key) ||
        ternaryCmp(isObj(lhs.value), isObj(rhs.value)) ||
        ternaryCmp(typeof lhs.value, typeof rhs.value) ||
        ternaryCmp(String(lhs.key), String(rhs.key))
    ).forEach(property => selectGroup(property).push(property));
    const expanded = groups.filter(group => group.verify).map(group => group.expand).join(``);
    const [origin, prefix, suffix] = !expanded.includes(`\n`) ? [``, ``, ``] : [formatCustom(
        data === receiver ? target.pathResolve() : name,
        opts.origin,
    ), current, previous];
    const output = formatCustom(prefix + expanded + suffix, opts.object);
    return `(${length})${output}${origin}`;
}

function createObjectGroups(target, options) {
    const opts = normalizeOptions(options);
    const { data, name, path, indent, receiver } = target;
    const { current } = indent.resolve;
    const prepend = indent.with(-1, opts.header).resolve.current;
    class GroupBase {
        push(_) {
            return undefined;
        }
        predicate(_) {
            return false;
        }
        get verify() {
            return false;
        }
        get expand() {
            return ``;
        }
    }
    class GroupProperty extends GroupBase {
        constructor(header, predicate) {
            super();
            this.header = header;
            this.predicate = predicate ?? this.predicate;
            this.mutablePropertyList = [];
        }
        push(property) {
            this.mutablePropertyList.push(property);
        }
        get verify() {
            return this.mutablePropertyList.length > 0;
        }
        get expand() {
            const tagged = formatCustom(this.header, opts.header);
            const length = this.mutablePropertyList.length;
            const output = this.formatter();
            return `${prepend}${tagged}(${length})${current}${output}${current}`;
        }
        formatter() {
            return ``;
        }
    }
    class GroupPropertyKey extends GroupProperty {
        constructor(...args) {
            super(...args);
        }
        formatter() {
            const newline = this.mutablePropertyList.length < opts.newlineLimitGroup;
            return this.mutablePropertyList.map(({ key, descr }) =>
                format(key) + formatDescriptor(descr, opts)
            ).join(newline ? current : `,`);
        }
    }
    class GroupPropertyEntry extends GroupProperty {
        constructor(...args) {
            super(...args);
        }
        formatter() {
            const longest = (max, { key }) => max.length > key.length ? max : key;
            const padding = format(this.mutablePropertyList.reduce(longest, ``)).length;
            return this.mutablePropertyList.map(({ key, value, descr }, index) => {
                const expanded = format(new Target(
                    value, key, path.concat(stringifyKey(key)), indent.next(opts)
                ), opts);
                const hasNewline = expanded.includes(`\n`);
                const accessed = format(key).padEnd(hasNewline ? 0 : padding);
                const spacer = hasNewline && index < this.mutablePropertyList.length - 1 ? current : ``;
                return `${accessed} = ${expanded}${formatDescriptor(descr, opts)}${spacer}`;
            }).join(current);
        }
    }
    class GroupPrototype extends GroupBase {
        get verify() {
            return !opts.prtype.format.ignore;
        }
        get expand() {
            const objPrtype = Object.getPrototypeOf(data);
            const strPrtype = formatCustom(objPrtype, opts.prtype);
            const indPrtype = indent.with(-1, opts.prtype);
            const accessed = formatCustom(`__proto__`, opts);
            const expanded = format(new Target(
                objPrtype,
                `${stringifyKey(name)}.${strPrtype}`,
                path.concat(strPrtype),
                indPrtype.next(opts),
                receiver
            ), opts);
            return `${indPrtype.resolve.current}${accessed} = ${expanded}${current}`;
        }
    }
    class GroupIterator extends GroupBase {
        #iterable = false;
        predicate({ key, value }) {
            return key === Symbol.iterator && typeof value === `function`;
        }
        push(_) {
            this.#iterable = true;
        }
        get verify() {
            return this.#iterable;
        }
        get expand() {
            const tagged = formatCustom(`iterator`, opts.header);
            const output = this.formatter();
            return `${prepend}${tagged}${current}${output}${current}`;
        }
        formatter() {
            const size = receiver.size ?? receiver.length ?? 20; // is integer check
            const iter = receiver[Symbol.iterator]();
            const next = indent.next(opts);
            const prtypeChain = arg => isObj(arg) && arg !== Object.prototype ? [arg].concat(
                prtypeChain(Object.getPrototypeOf(arg))
            ) : [];
            const accessed = formatSymbol(Symbol.iterator, opts);
            const expanded = format(new Target(
                receiver[Symbol.iterator], accessed, path.concat(accessed), next
            ), opts, cyclicRefDict);
            const entries = format(new Target( // opts: skip origin, add nested element types
                Array.from(iter.take(size)), accessed, path.concat(accessed), next
            ), { originProperty: false }, cyclicRefDict); // pass rest of opts after fixing deepMerge Array merge
            const type = formatCustom(iter, opts.type);
            const prtypes = prtypeChain(Object.getPrototypeOf(iter)).map(
                obj => formatCustom(obj, opts.prtype)
            ).join(`.`);
            const invoked = formatCustom(`invoked-( ${type}.${prtypes} )`, opts);
            return `${accessed} = ${expanded} ->${current}${invoked} = ${entries}`;
        }
    }
    return {
        GroupPropertyEntry,
        GroupPropertyKey,
        GroupIterator,
        GroupPrototype,
    };
}

function formatArray(target, options, cyclicRefDict) {
    const opts = normalizeOptions(options);
    const { name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const arr = Array.from(receiver);
    const firstType = strType(arr[0]);
    const isSameType = arr.every(item => strType(item) === firstType);
    const newline = arr.length < opts.newlineLimitArray;
    const [prefix, append] = !newline ? [` `, ` `] : [current, `,${previous}`];
    const formatItem = (item, indexed) => format(new Target(
        item, indexed, path.concat(indexed), newline ? indent.next(opts) : indent
    ), opts, cyclicRefDict);
    const expanded = !arr.length ? `` : arr.map(
        (item, index) => prefix + formatItem(item, `${name}[${index}]`)
    ).join(`,`) + append;
    const origin = !opts.originProperty ? `` : formatCustom(target.pathResolve(), opts.origin);
    const itemType = !isSameType ? `` : `${firstType}: `;
    return `(${itemType}${arr.length})${formatCustom(expanded, opts)}${origin}`;
}

function formatArrayLike() {
    return null; // array item name to array[index]
}


//-----#
//-----# Format.Simple
//-----#

function stringifyKey(key, options) {
    return typeof key === `symbol` ? formatSymbol(key, options) : key;
}

function formatDescriptor(descr = {}, options) {
    const descrModified = [
        [`W`, descr.writable === false],
        [`E`, descr.enumerable === false],
        [`C`, descr.configurable === false],
        [`G`, typeof descr.get === `function`],
        [`S`, typeof descr.set === `function`],
    ].filter(([, predicate]) => predicate).map(([value]) => value).join(``);
    return !descrModified ? `` : formatCustom(descrModified, options.descriptor);
}


//-----#
//-----# Operation.String
//-----#

function strType(arg) {
    return isObj(arg) ? Object.prototype.toString.call(arg).slice(8, -1) : typeof arg;
}


//-----#
//-----# Operation.Predicate
//-----#

function isPrototype(arg) {
    return isObj(arg) && arg === arg.constructor.prototype;
}

function isArrayOnly(arg, length) {
    return Array.isArray(arg) && isArrayMinimal(arg, length);
}

function isArrayMinimal(arg, length) {
    return isArrayLike(arg) && arg.length === (length ?? Reflect.ownKeys(arg).length) - 1;
}

function isArrayLike(arg) {
    return isObj(arg) && Number.isInteger(arg.length) && arg.length >= 0;
}

function isIterable(arg) {
    return isObj(arg) && typeof arg[Symbol.iterator] === `function`;
}

function isGetter(desc = {}) {
    return typeof desc.get === `function`;
}

function isObj(arg) {
    return Boolean(arg) && typeof arg === `object`;
}


//-----#
//-----# Class
//-----#

class Target { // Overhaul to Metadata class / Context / State / TraversalState & state
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
        return this.#name ?? strType(this.data);
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

class Indentation {
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


//-----#
//-----# Options
//-----#

function createDefaultOptions() {
    return { // existing object blocklist
        newlineLimitGroup: 40,
        newlineLimitArray: 40,
        minimizeSameTypeArray: true,
        originProperty: true,
        format: {
            prefix: `[`,
            suffix: `]`,
        },
        indent: {
            base: `|`,
            fill: ` `,
            size: 8,
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
                prefix: `\\ `,
                suffix: ``,
            },
            indent: {
                base: `|`,
                fill: `¨`,
                size: 8,
            },
        },
        prtype: {
            format: {
                modify: strType,
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
                Array.prototype,
                Iterator.prototype,
            ],
        },
        type: {
            format: {
                ignore: true,
                modify: strType,
                prefix: `<`,
                suffix: `>`,
            },
        },
        empty: {
            indent: {
                base: ` `,
                fill: ` `,
                size: 4,
            },
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
}
const normalized = new Set([defaults]);
export function normalizeOptions(arg) {
    if (!isObj(arg)) {
        return defaults;
    }
    if (normalized.has(arg)) {
        return arg;
    }
    const opts = deepMergeCopy(arg, defaults); // add "known" deepMerge that only merge existing defaults keys
    normalized.add(opts);
    return opts;
}
export function deepMergeCopy(priority, fallback, verifier) {
    const verify = Boolean(verifier) ? verifier : (closure => ({
        priority: closure(new Set()),
        fallback: closure(new Set()),
    }))(set => key => {
        if (isObj(key)) {
            if (set.has(key)) {
                throw `[insert-circular-reference-solution-here]`;
            }
            set.add(key);
        }
    });
    if (priority === undefined) {
        return fallback === undefined ? undefined : deepMergeCopy(fallback, undefined, verify);
    }
    if (!isObj(priority) || isPrototype(priority)) {
        return priority;
    }
    if (isPrototype(fallback)) {
        return deepMergeCopy(priority, undefined, verify);
    }
    verify.priority(priority);
    verify.fallback(fallback);
    if (isArrayOnly(priority)) { // merge items if both are objects with same index
        return priority.concat(
            isArrayOnly(fallback) ? fallback.slice(priority.length) : []
        ).map(item => deepMergeCopy(item, undefined, verify));
    }
    if (!isObj(fallback)) {
        if (isIterable(priority)) {
            return priority; // shallow copy for iterable like Map, fix later
        }
        return Reflect.ownKeys(priority).reduce((copy, key) => ( // cursed syntax btw
            copy[key] = deepMergeCopy(priority[key], undefined, verify), copy
        ), {});
    }
    return Array.from(new Set([
        ...Reflect.ownKeys(priority),
        ...Reflect.ownKeys(fallback),
    ])).reduce((copy, key) => (
        (copy[key] = deepMergeCopy(priority[key], fallback[key], verify)), copy
    ), {});
}


//-----#
//-----# Logger
//-----#

export function log(...args) {
    return logCustom({ type: { format: { ignore: false } } }, console.log, ...args);
}

export function logCustom(options, logger = console.log, ...args) { // add param logger, return fn
    const opts = normalizeOptions(options);
    const header = `[${new URL(import.meta.url).pathname.slice(1)}]`;
    const spacer = `\n\n${`-`.repeat(31)}\n\n`;
    const indent = new Indentation();
    const output = args.map((arg, num) => {
        try {
            const keys = isObj(arg) ? Reflect.ownKeys(arg) : [];
            const captured = keys.length === 1 && strType(arg) === `Object`;
            const [name, data] = captured ? [keys[0], arg[keys[0]]] : [formatCustom(arg, opts.type), arg];
            const prepend = captured ? `${format(name)} = ` : ``;
            const expanded = format(new Target(data, name, [name], indent.next(opts)), opts, cyclicRefDict);
            return `${spacer}[${num}]: ${prepend}${expanded}`;
        } catch (error) {
            return `${spacer}[${num}]: ${format(error)}`;
        }
    }).join(``);
    return logger(header + output);
    // make objDone to Map, filter all entries above 1, print last
}
