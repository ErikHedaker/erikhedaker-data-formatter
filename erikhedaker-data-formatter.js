'use strict';

//-----#
//-----# Combinator.Pure
//-----#

function identity(arg) {
    return arg;
}

function constant(arg) {
    return () => arg;
}

function flip(func) {
    return (y) => (x) => func(x)(y)
}


//-----#
//-----# Combinator.Variadic
//-----#

function thrush(...args) {
    return (func) => func(...args);
}

function compose(...funcs) {
    return (arg) => funcs.reduceRight((acc, fn) => fn(acc), arg);
}

function partial(func, ...prepend) {
    return (...args) => func(...prepend, ...args);
}

function curry(func) {
    const num = (arg) => arg.length;
    const arity = num(func);
    const sated = (args) => num(args) >= arity;
    const curried = (...args) => sated(args) ? func(...args) : partial(curried, ...args);
    return curried;
}


//-----#
//-----# Combinator.Array
//-----#

function map(func) {
    return (arr) => arr.map(func);
}

function filter(func) {
    return (arr) => arr.filter(func);
}

function join(joiner) {
    return (arr) => arr.join(joiner);
}


//-----#
//-----# Transformer
//-----#

function access(key) {
    return (obj) => obj[key];
}

function equals(a) {
    return (b) => a === b;
}


//-----#
//-----# Memoized
//-----#

const optionsWithOverride = (() => {
    const defaults = createDefaultOptions();
    return (options = {}) => Object.assign(defaults, options);
})();

const isKnownSymbol = (() => {
    const knownSymbols = compose(
        (array) => new Set(array),
        filter((x) => typeof x === `symbol`),
        map((key) => Symbol[key]),
        Reflect.ownKeys,
    )(Symbol);
    return (sym) => knownSymbols.has(sym);
})();

const formatDescriptor = (() => {
    const isFalse = equals(false);
    const isFunc = equals(`function`);
    const typeOf = (value) => typeof value;
    const propFlag = (key) => compose(isFalse, access(key));
    const propFunc = (key) => compose(isFunc, typeOf, access(key));
    const dTableDescr = createPredicateTable([
        [propFlag(`writable`), `W`],
        [propFlag(`enumerable`), `E`],
        [propFlag(`configurable`), `C`],
        [propFunc(`get`), `G`],
        [propFunc(`set`), `S`],
    ]);
    const toStrBinder = ({ predicate, value }) => (descr) => predicate(descr) ? value : ``;
    const toStr = compose(thrush, join(``), compose(flip(compose(map, thrush)), map(toStrBinder))(dTableDescr));
    const isEmpty = equals(``);
    const getEmpty = constant(``);
    const formatCustomFlipped = compose(flip, curry)(formatCustom);
    return (descr = {}, options = {}) => {
        const format = formatCustomFlipped(options.descriptor);
        const invoke = toStr(descr);
        const expand = invoke(isEmpty) ? getEmpty : format;
        return invoke(expand);
    };
})();

export const formatAny = (() => {
    const dTableFormatSelect = createDispatchTable([
        [(target) => target.data === null, () => `null`],
        [(target) => target.data instanceof Date, () => `date`],
        [(target) => target.data instanceof Error, () => `error`],
    ], (target) => typeof target.data);
    const dTableFormat = createDispatchTable([
        [(str) => str === `function`, (target, opts) => formatCustom(target.data.name, opts)],
        [(str) => str === `string`, (target, opts) => formatCustom(`"${target.data}"`, opts)],
        [(str) => str === `symbol`, (target, opts) => formatSymbol(target.data, opts)],
        [(str) => str === `object`, (target, opts) => formatObject(target, opts)],
        [(str) => str === `error`, (target, opts) => formatCustom(target.data.stack, opts.error)],
    ], (target, opts) => formatCustom(String(target.data), opts));
    return (arg, options) => {
        const opts = normalizeOptions(options);
        const target = Target.normalize(arg);
        const selected = dTableFormatSelect(target)(target);
        const expanded = dTableFormat(selected)(target, opts);
        const dataType = formatCustom(target.data, opts.type);
        return dataType + expanded;
    };
})();

function createPredicateTable(pairs) {
    const template = ([predicate, value]) => ({ predicate, value });
    return pairs.map(template);
};


function createDispatchTable(pairs, fallback) {
    const truthy = (arg) => ({ predicate }) => predicate(arg);
    const table = createPredicateTable(pairs);
    return (arg) => table.find(truthy(arg))?.value ?? fallback;
};


//-----#
//-----# Format.Complex
//-----#

const cyclicRefDict = new Map();
function formatObject(target, options) {
    //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
    //unroll iterator, filter keys if items contain keys from object
    const opts = normalizeOptions(options);
    const indent = target.indenter.resolve;
    const keys = Reflect.ownKeys(target.data); // Set // add array and iterable keys into Set, filter keys based on that
    const length = keys.length;
    const prtype = Object.getPrototypeOf(target.data);
    const prtypeRef = cyclicRefDict.get(prtype);
    const objRef = cyclicRefDict.get(target.data);
    const isExcluded = arg => opts.prtype.exclude.some(obj => obj === arg);
    const filtered = () => formatCustom(`is-filtered`, opts.object);
    const formatCopyOf = ([path]) => ( // better name
        str => formatCustom(indent.current + str + indent.previous, opts.object)
    )(`is-copy-of-( ${path.join(`.`)} )`);
    const copyOf = paths => () => (paths.push(target.path), formatCopyOf(paths)); // better name
    const formatEarlyReturn = [
        [filtered, isExcluded(target.data)],
        [filtered, isExcluded(prtype) && !length],
        [copyOf(objRef), Boolean(objRef)],
        [copyOf(prtypeRef), Boolean(prtypeRef) && !length],
        [() => formatArray(target, opts), isArrayOnly(target.receiver, length)],
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
        GroupPrototype,
        GroupIterator,
    } = createObjectGroups(target, opts);
    const primitives = GroupPropertyEntry(`primitive`);
    const groups = [
        primitives,
        GroupPropertyEntry(`getter`, ({ value, descr }) => value != null && isGetter(descr)),
        GroupIterator(`iterator`),
        GroupPropertyEntry(`object`, ({ value }) => isObj(value)),
        GroupPropertyEntry(`array`, ({ value }) => isArrayLike(value)),
        GroupPropertyKey(`function`, ({ value }) => typeof value === `function`),
        GroupPropertyKey(`null`, ({ value }) => value === null),
        GroupPropertyKey(`undefined`, ({ value }) => value === undefined),
        GroupPrototype(`__proto__`),
    ];
    const truthy = (arg) => ({ predicate }) => predicate(arg);
    const selectGroup = (property) => groups.find(truthy(property)) ?? primitives;
    const mutateGroup = (property) => selectGroup(property).push(property);
    const propertyWhenError = (key, error) => ({ key, value: error, descr: undefined });
    const propertyFromKeyThrowable = (key) => ({
        key,
        value: Reflect.get(target.data, key, target.receiver),
        descr: Reflect.getOwnPropertyDescriptor(target.data, key),
    });
    const propertyFromKey = (key) => {
        try {
            return propertyFromKeyThrowable(key);
        } catch (error) {
            return propertyWhenError(key, error);
        }
    };
    const ternaryCmp = (a, b) => a === b ? 0 : a > b ? 1 : -1;
    const propertySorter = (a, b) =>
        ternaryCmp(typeof a.key, typeof b.key) ||
        ternaryCmp(isObj(a.value), isObj(b.value)) ||
        ternaryCmp(typeof a.value, typeof b.value) ||
        ternaryCmp(String(a.key), String(b.key));
    cyclicRefDict.set(target.data, [target.path]);
    keys.map(propertyFromKey).toSorted(propertySorter).forEach(mutateGroup);
    const expanded = groups.filter((group) => group.verify).map((group) => group.expand).join(``);
    const [origin, prefix, suffix] = !expanded.includes(`\n`) ? [``, ``, ``] : [formatCustom(
        target.data === target.receiver ? target.pathResolve() : target.name,
        opts.origin,
    ), indent.current, indent.previous];
    const output = formatCustom(prefix + expanded + suffix, opts.object);
    return `(${length})${output}${origin}`;
}

function createObjectGroups(target, options) {
    return {
        GroupPropertyEntry: partial(createObjectGroupPropertyEntry, target, options),
        GroupPropertyKey: partial(createObjectGroupPropertyKey, target, options),
        GroupPrototype: partial(createObjectGroupPrototype, target, options),
        GroupIterator: partial(createObjectGroupIterator, target, options),
    };
}

function createObjectGroupBase(target, options, header) {
    const opts = normalizeOptions(options);
    const tagHeader = formatCustom(header, opts.header);
    const tagPrefix = target.indenter.with(-1, opts.header).resolve.current;
    const { current } = target.indenter.resolve;
    const mutableList = [];
    return {
        opts,
        tagHeader,
        tagPrefix,
        current,
        mutableList,
        expand: (format) => `${tagPrefix}${tagHeader}(${mutableList.length})${current}${format()}${current}`,
        verify: () => mutableList.length > 0,
        push: (item) => mutableList.push(item),
    };
}

function createObjectGroupPropertyKey(target, options, header, predicate = constant(false)) {
    const {
        opts,
        current,
        mutableList,
        expand,
        verify,
        push,
    } = createObjectGroupBase(target, options, header);
    const isOverLimit = () => mutableList.length < opts.newlineLimitGroup;
    const keyToStr = ({ key, descr }) => formatAny(key) + formatDescriptor(descr, opts);
    const format = () => mutableList.map(keyToStr).join(isOverLimit() ? current : `,`);
    return {
        get expand() {
            return expand(format);
        },
        get verify() {
            return verify();
        },
        push,
        predicate,
    };
}

function createObjectGroupPropertyEntry(target, options, header, predicate = constant(false)) {
    const {
        opts,
        current,
        mutableList,
        expand,
        verify,
        push,
    } = createObjectGroupBase(target, options, header);
    const entryToStr = (padding) => ({ key, value, descr }, index) => {
        const descriptor = formatDescriptor(descr, opts);
        const expanded = formatAny(new Target(
            value, key, target.path.concat(stringifyKey(key)), target.indenter.next(opts)
        ), opts);
        const hasNewline = expanded.includes(`\n`);
        const accessed = formatAny(key).padEnd(hasNewline ? 0 : padding);
        const spacer = hasNewline && index < mutableList.length - 1 ? current : ``;
        return `${accessed} = ${expanded}${descriptor}${spacer}`;
    };
    const longestKey = (max, { key }) => max.length > key.length ? max : key;
    const format = () => {
        const longest = mutableList.reduce(longestKey, ``);
        const padding = formatAny(longest).length;
        const toStr = entryToStr(padding);
        return mutableList.map(toStr).join(current);
    };
    return {
        get expand() {
            return expand(format);
        },
        get verify() {
            return verify();
        },
        push,
        predicate,
    };
}

function createObjectGroupPrototype(target, options, header) {
    const {
        opts,
        current,
    } = createObjectGroupBase(target, options, header);
    const prtypeToStr = () => {
        const accessed = formatCustom(header, opts);
        const prtypeIndent = target.indenter.with(-1, opts.prtype);
        const prtypeObject = Object.getPrototypeOf(target.data);
        const prtypeRouted = formatCustom(prtypeObject, opts.prtype);
        const prtypeTarget = new Target(
            prtypeObject,
            `${stringifyKey(target.name)}.${prtypeRouted}`,
            target.path.concat(prtypeRouted),
            prtypeIndent.next(opts),
            target.receiver
        );
        const expanded = formatAny(prtypeTarget, opts);
        return `${prtypeIndent.resolve.current}${accessed} = ${expanded}${current}`;
    };
    return {
        get expand() {
            return prtypeToStr();
        },
        verify: !opts.prtype.format.ignore,
        push: constant(null),
        predicate: constant(false),
    };
}

function createObjectGroupIterator(target, options, header) {
    const {
        opts,
        tagHeader,
        tagPrefix,
        current,
    } = createObjectGroupBase(target, options, header);
    let isIterable = false;
    const iteratorToStr = () => {
        const size = target.receiver.size ?? target.receiver.length ?? 20; // is integer check
        const iter = target.receiver[Symbol.iterator]();
        const next = target.indenter.next(opts);
        const prtypeChain = (arg) => isObj(arg) && arg !== Object.prototype ? [arg].concat(
            prtypeChain(Object.getPrototypeOf(arg))
        ) : [];
        const accessed = formatSymbol(Symbol.iterator, opts);
        const expanded = formatAny(new Target(
            target.receiver[Symbol.iterator], accessed, target.path.concat(accessed), next
        ), opts, cyclicRefDict);
        const entries = formatAny(new Target( // opts: skip origin, add nested element types
            Array.from(iter.take(size)), accessed, target.path.concat(accessed), next
        ), { originProperty: false }, cyclicRefDict); // pass rest of opts after fixing deepMerge Array merge
        const type = formatCustom(iter, opts.type);
        const prtypes = prtypeChain(Object.getPrototypeOf(iter)).map(
            obj => formatCustom(obj, opts.prtype)
        ).join(`.`);
        const invoked = formatCustom(`invoked-( ${type}.${prtypes} )`, opts);
        return `${accessed} = ${expanded} ->${current}${invoked} = ${entries}`;
    };
    return {
        get expand() {
            return `${tagPrefix}${tagHeader}${current}${iteratorToStr()}${current}`;
        },
        get verify() {
            return isIterable;
        },
        push: () => isIterable = true,
        predicate: ({ key, value }) => key === Symbol.iterator && typeof value === `function`,
    };
}

function formatArray(target, options, cyclicRefDict) {
    const opts = normalizeOptions(options);
    const indent = target.indenter.resolve;
    const arr = Array.from(target.receiver);
    const firstType = strType(arr[0]);
    const isSameType = arr.every(item => strType(item) === firstType);
    const newline = arr.length < opts.newlineLimitArray;
    const [prefix, append] = !newline ? [` `, ` `] : [indent.current, `,${indent.previous}`];
    const formatItem = (item, indexed) => formatAny(new Target(
        item, indexed, target.path.concat(indexed), newline ? target.indenter.next(opts) : target.indenter
    ), opts, cyclicRefDict);
    const expanded = !arr.length ? `` : arr.map(
        (item, index) => prefix + formatItem(item, `${target.name}[${index}]`)
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

function formatSymbol(sym, options = {}) {
    const msg = sym.description;
    const str = isKnownSymbol(sym) ? msg : (Boolean(msg) ? `Symbol("${msg}")` : `Symbol()`);
    return formatCustom(str, options);
}

function formatCustom(arg, options) {
    const {
        prefix = ``,
        suffix = ``,
        modify = identity,
        ignore = false,
    } = optionsWithOverride(options).format;
    return ignore ? `` : `${prefix}${modify(arg)}${suffix}`;
}


//-----#
//-----# Operation.String
//-----#

function strType(arg) {
    return isObj(arg) ? Object.prototype.toString.call(arg).slice(8, -1) : typeof arg;
}


//-----#
//-----# Operation.Boolean
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

function isObj(arg) {
    return Boolean(arg) && typeof arg === `object`;
}

function isGetter(desc = {}) {
    return typeof desc.get === `function`;
}

//-----#
//-----# Class
//-----#

class Target { // Overhaul to Metadata class / Context / State / TraversalState & state
    #name;
    #path;
    #indenter;
    #receiver;
    constructor(data, name, path, indent, receiver) {
        this.data = data;
        this.#name = name;
        this.#path = path;
        this.#indenter = indent;
        this.#receiver = receiver;
    }
    get name() {
        return this.#name ?? strType(this.data);
    }
    get path() {
        return this.#path ?? [this.name];
    }
    get indenter() {
        return this.#indenter ?? new Indentation().next();
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
    set indenter(arg) {
        this.#indenter = arg;
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
    static step(options) {
        const {
            base = ``,
            fill = ``,
            size = 0,
        } = optionsWithOverride(options).indent;
        return base.padEnd(size, fill);
    }
}


//-----#
//-----# Options
//-----#

function createDefaultOptions() { // existing object blocklist
    const templateFormat = (
        prefix = ``,
        suffix = ``,
        modify = identity,
        ignore = false,
    ) => ({ prefix, suffix, modify, ignore });
    const templateIndent = (
        base = ``,
        fill = ``,
        size = 0,
    ) => ({ base, fill, size });
    return {
        newlineLimitGroup: 40,
        newlineLimitArray: 40,
        minimizeSameTypeArray: true,
        originProperty: true,
        format: templateFormat(`[`, `]`),
        indent: templateIndent(`|`, ` `, 8),
        object: {
            format: templateFormat(`{`, `}`),
        },
        descriptor: {
            format: templateFormat(`'`, ``),
        },
        origin: {
            format: templateFormat(`( `, ` )`),
        },
        header: {
            format: templateFormat(`\\ `, ``),
            indent: templateIndent(`|`, `¨`, 8),
        },
        prtype: {
            format: templateFormat(`[[`, `]]`, strType),
            indent: templateIndent(`|`, `-`, 4),
            exclude: [
                Object.prototype,
                Array.prototype,
                Iterator.prototype,
            ],
        },
        type: {
            format: templateFormat(`<`, `>`, strType, true),
        },
        error: {
            format: templateFormat(`<ERROR>\n`, `\n</ERROR>`, strType, true),
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
const normalizeOptionsDefault = createDefaultOptions();
const normalized = new Set([normalizeOptionsDefault]);
export function normalizeOptions(arg) {
    if (!isObj(arg)) {
        return normalizeOptionsDefault;
    }
    if (normalized.has(arg)) {
        return arg;
    }
    // add "known" deepMerge that only merge existing defaults keys
    const opts = deepMergeCopy(arg, normalizeOptionsDefault);
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
            const prepend = captured ? `${formatAny(name)} = ` : ``;
            const expanded = formatAny(new Target(data, name, [name], indent.next(opts)), opts, cyclicRefDict);
            return `${spacer}[${num}]: ${prepend}${expanded}`;
        } catch (error) {
            return `${spacer}[${num}]: ${formatAny(error)}`;
        }
    }).join(``);
    return logger(header + output);
    // make objDone to Map, filter all entries above 1, print last
}
