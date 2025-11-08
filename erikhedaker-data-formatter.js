'use strict';

//-----#
//-----# TODO
//-----#
function formatCustom(value, options) { // Precomputation // incorporate formatSymbol?
    //const defaults = {};
    const {
        prefix = ``,
        suffix = ``,
        modify = identity,
        ignore = false,
    } = options?.format ?? {};
    return ignore ? `` : `${prefix}${modify(value)}${suffix}`;
}
const normalizeOptions = (() => {
    const defaults = createDefaultOptions();
    const memoized = new Map([[defaults, defaults]]);
    return function normalizeOptions(options) {
        if (memoized.has(options)) {
            return memoized.get(options);
        }
        if (!isObj(options)) {
            return defaults;
        }
        const normalized = deepCopyMerge(options, defaults);
        memoized.set(options, normalized);
        memoized.set(normalized, normalized);
        return normalized;
    };
})();
function deepCopyMerge(priority, fallback, verifier) {
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
        return fallback === undefined ? undefined : deepCopyMerge(fallback, undefined, verify);
    }
    if (!isObj(priority) || isPrototype(priority)) {
        return priority;
    }
    if (isPrototype(fallback)) {
        return deepCopyMerge(priority, undefined, verify);
    }
    verify.priority(priority);
    verify.fallback(fallback);
    if (isArrayOnly(priority)) { // merge items if both are objects with same index
        return priority.concat(
            isArrayOnly(fallback) ? fallback.slice(priority.length) : []
        ).map(item => deepCopyMerge(item, undefined, verify));
    }
    if (!isObj(fallback)) {
        if (isIterable(priority)) {
            return priority; // shallow copy for iterable like Map, fix later
        }
        return Reflect.ownKeys(priority).reduce((copy, key) => ( // cursed syntax btw
            copy[key] = deepCopyMerge(priority[key], undefined, verify), copy
        ), {});
    }
    return Array.from(new Set([
        ...Reflect.ownKeys(priority),
        ...Reflect.ownKeys(fallback),
    ])).reduce((copy, key) => (
        (copy[key] = deepCopyMerge(priority[key], fallback[key], verify)), copy
    ), {});
}


//-----#
//-----# Precomputation
//-----#

const formatObject = (() => {
    /*
    const isArrayItem = (isParentArray =>
        ([key]) => isParentArray && parseInt(String(key)) >= 0
    )(isArrayLike(receiver));
    */

    //const isExcluded = (value) => isPrototype(value) && opts.prtype.exclude.some((name) => name === strType(value));
    //const isExcluded = value => opts.prtype.exclude.some(obj => obj === value);
    const isTypeExcluded = (value, options) => {
        const excludeTypes = options.prtype.exclude;
        return excludeTypes.some((type) => type === strType(value));
    };
    const wasFiltered = (options) => formatCustom(`is-filtered`, options.object);
    /*
    const formatCyclicReference = ([path], indented, options) => {
        const pathing = path.join(`.`);
        const output = `is-copy-of-( ${pathing} )`;
        return formatCustom(indented.current + output + indented.previous, options.object);
    };
        const formatCopyOf = ([path]) => ( // better name
            str => formatCustom(indented.current + str + indented.previous, target.options.object)
        )(`is-copy-of-( ${path.join(`.`)} )`);
        const copyOf = paths => () => (paths.push(target.path), formatCopyOf(paths)); // better name
    */
    return function formatObject(target) {
        //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
        //unroll iterator, filter keys if items contain keys from object
        const {
            cyclicRefDict,
        } = target;
        const indented = target.indent.resolve;
        const keys = Reflect.ownKeys(target.value); // Set // add array and iterable keys into Set, filter keys based on that
        const length = keys.length;
        const cyclic = cyclicRefDict.get(target.value);
        if (Boolean(cyclic)) {
            return `{cyclic}`;
        }
        if (target.value === Array.prototype) {
            return `{Array.prototype}`;
        }
        if (target.value === Object.prototype) {
            return `{Object.prototype}`;
        }
        if (target.value === Iterator.prototype) {
            return `{Iterator.prototype}`;
        }
        if (isArrayOnly(target.receiver, length)) {
            return formatArray(target);
        }
        const {
            GroupKey,
            GroupEntry,
            GroupIterator,
            GroupPrtype,
        } = createObjectGroups(target);
        const primitives = GroupEntry(`primitive`);
        const groups = [
            primitives,
            GroupEntry(`getter`, ({ value, descr }) => value != null && isGetter(descr)),
            GroupIterator(`iterator`),
            GroupEntry(`object`, ({ value }) => isObj(value)),
            GroupEntry(`array`, ({ value }) => isArrayLike(value)), // above object
            GroupKey(`function`, ({ value }) => typeof value === `function`),
            GroupKey(`null`, ({ value }) => value === null),
            GroupKey(`undefined`, ({ value }) => value === undefined),
            GroupPrtype(`__proto__`),
        ];
        const truthy = (value) => ({ predicate }) => predicate(value);
        const selectGroup = (property) => groups.find(truthy(property)) ?? primitives;
        const mutateGroup = (property) => selectGroup(property).push(property);
        const propertyWhenError = (key, error) => ({ key, value: error, descr: undefined });
        const propertyFromKeyThrowable = (key) => ({
            key,
            value: Reflect.get(target.value, key, target.receiver),
            descr: Reflect.getOwnPropertyDescriptor(target.value, key),
        });
        const propertyFromKey = (key) => {
            try {
                return propertyFromKeyThrowable(key);
            } catch (error) {
                throw error; //debug
                return propertyWhenError(key, error);
            }
        };
        const ternaryCmp = (a, b) => a === b ? 0 : a > b ? 1 : -1;
        const propertySorter = (a, b) =>
            ternaryCmp(typeof a.key, typeof b.key) ||
            ternaryCmp(isObj(a.value), isObj(b.value)) ||
            ternaryCmp(typeof a.value, typeof b.value) ||
            ternaryCmp(String(a.key), String(b.key));
        cyclicRefDict.set(target.value, target.route);
        keys.map(propertyFromKey).toSorted(propertySorter).forEach(mutateGroup);
        const expanded = groups.filter((group) => group.verify).map((group) => group.expand).join(``);
        const [origin, prefix, suffix] = !expanded.includes(`\n`) ? [``, ``, ``] : [formatCustom(
            target.traceOrigin(),
            target.options.origin,
        ), indented.current, indented.previous];
        const output = formatCustom(prefix + expanded + suffix, target.options.object);
        return `(${length})${output}${origin}`;
    };
})();


const createIndentation = (() => {
    const empty = ``;
    const fallback = [`\n`];
    const defaults = normalizeOptions().indent;
    const step = (options = defaults) => {
        const { base, fill, size } = { ...defaults, ...options?.indent };
        //const { base, fill, size } = normalizeOptions(options).indent;
        return base.padEnd(size, fill);
    };
    const copy = (clone) => compose(createIndentation, clone, step);
    const reiterate = (steps) => copy((value) => steps.with(-1, value));
    const increment = (steps) => copy((value) => steps.concat(value));
    const resolve = (steps) => ({
        current: steps.join(empty),
        previous: steps.slice(0, -1).join(empty),
    });
    return function createIndentation(steps = fallback) {
        return {
            reiterate: reiterate(steps),
            increment: increment(steps),
            get resolve() {
                return resolve(steps);
            },
        };
    };
})();

const isKnownSymbol = (() => {
    const knownSymbols = compose(
        (array) => new Set(array),
        filter((x) => typeof x === `symbol`),
        map((key) => Symbol[key]),
        Reflect.ownKeys,
    )(Symbol);
    return function isKnownSymbol(sym) {
        return knownSymbols.has(sym);
    };
})();

const formatDescriptor = (() => {
    const isFalse = equals(false);
    const isFunc = equals(`function`);
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
    const thrushToArr = compose(flip(compose(map, thrush)), map(toStrBinder));
    const thrushToStr = compose(thrush, join(``), thrushToArr(dTableDescr));
    const isEmpty = equals(``);
    const getEmpty = constant(``);
    const formatDescrFlip = compose(flip, curry)(formatCustom);
    return function formatDescriptor(descr = {}, options = {}) {
        const format = formatDescrFlip(options.descriptor);
        const invoke = thrushToStr(descr);
        const expand = invoke(isEmpty) ? getEmpty : format;
        return invoke(expand);
    };
})();

export const formatAny = (() => { // break out into two, formatContext and format?
    const accessValue = access(`value`);
    const combinator = (f) => (g) => (x) => (y) => g(x)(f(y));
    const isData = combinator(accessValue);
    const isDataClass = isData(instanceOf);
    const dTableFormatArbiter = makeDispatchTable([
        [isData(equals)(null), constant(`null`)],
        [isDataClass(Date), constant(`date`)],
        [isDataClass(Error), constant(`error`)],
    ], compose(typeOf, accessValue));
    const dTableFormat = makeDispatchTable([ // replace with map
        [equals(`function`), ({ value, options }) => formatCustom(value.name, options)],
        [equals(`string`), ({ value, options }) => formatCustom(`"${value}"`, options)],
        [equals(`symbol`), ({ value, options }) => formatSymbol(value, options)],
        [equals(`object`), (target) => formatObject(target, target.options)],
        [equals(`error`), ({ value, options }) => formatCustom(value.stack, options.error)],
    ], ({ value, options }) => formatCustom(String(value), options));
    //change type from string to int mapping
    const fastPathSet = new Set([
        `number`,
        `bigint`,
        `boolean`,
        `undefined`,
        `null`,
    ]);
    const valueTypePrefix = ({ value, options }) => formatCustom(value, options.type);
    const defaults = normalizeOptions();
    return function formatAny(any) {
        const fastPathArg = typeof any;
        if (fastPathArg === `string`) {
            return formatCustom(`"${any}"`, defaults);
        }
        if (fastPathSet.has(fastPathArg)) {
            return formatCustom(String(any), defaults);
        }
        /*
        const {
            data = value,
        } = Context.isInstance(value) ? value : {};
        */
        const context = Context.isInstance(any) ? any : Context(any);
        const arbitrateType = dTableFormatArbiter(context)(context);
        const format = dTableFormat(arbitrateType);
        return valueTypePrefix(context) + format(context);
    };
})();


//-----#
//-----# Mutation
//-----#

export function log(...args) {
    return logCustom({ type: { format: { ignore: false } } }, console.log, ...args);
}

export function logCustom(override, logger, ...args) {
    const options = normalizeOptions(override);
    const indent = createIndentation().increment(options);
    const isCaptured = (value, keys) => (
        keys.length === 1 &&
        strType(value) === `Object` &&
        isObj(value[keys[0]])
    );
    const setupObj = (capturer, [name]) => [`${formatAny(name)} = `, name, capturer[name]];
    const setupAny = (value) => [``, formatCustom(value, options.type), value];
    const toStr = (arg) => {
        const keys = isObj(arg) ? Reflect.ownKeys(arg) : [];
        const [prepend, moniker, value] = isCaptured(arg, keys) ? setupObj(arg, keys) : setupAny(arg);
        const context = Context(value, moniker, null, options, indent);
        try {
            return prepend + formatAny(context);
        } catch (error) {
            throw error; //debug
            return formatAny(error);
        }
    };
    const spacer = `\n\n${`-`.repeat(31)}\n\n`;
    const moduleName = ({ url }) => `[${new URL(url).pathname.slice(1)}]`;
    const reduceToStrNum = (acc, str, num) => `${acc}${spacer}[${num}]: ${str}`;
    const header = moduleName(import.meta);
    const output = args.map(toStr).reduce(reduceToStrNum, ``);
    return logger(header + output);
    // make objDone to Map, filter all entries above 1, print last
}


//-----#
//-----# Format.Complex
//-----#

function formatArray(target) {
    const indented = target.indent.resolve;
    const arr = Array.from(target.receiver);
    const firstType = strType(arr[0]);
    const isSameType = arr.every(item => strType(item) === firstType);
    const newline = arr.length < target.options.newlineLimitArray;
    const [prefix, append] = !newline ? [` `, ` `] : [indented.current, `,${indented.previous}`];
    const formatItem = (item, index) => {
        const nextMoniker = `${target.moniker}[${index}]`;
        const nextIndent = newline ? target.indent.increment(target.options) : target.indent;
        //const nextTarget = new Target(item, nextName, nextPath, nextIndent);
        const next = Context(item, nextMoniker, target, target.options, nextIndent);
        return prefix + formatAny(next);
    };
    const expanded = !arr.length ? `` : arr.map(formatItem).join(`,`) + append;
    const origin = !target.options.originProperty ? `` : formatCustom(target.traceOrigin(), target.options.origin);
    const itemType = !isSameType ? `` : `${firstType}: `;
    return `(${itemType}${arr.length})${formatCustom(expanded, target.options)}${origin}`;
}

function formatArrayLike() {
    return null; // array item name to array[index]
}


//-----#
//-----# Format.Simple
//-----#

function formatSymbol(sym, options) {
    const msg = sym.description;
    const str = isKnownSymbol(sym) ? msg : (Boolean(msg) ? `Symbol("${msg}")` : `Symbol()`);
    return formatCustom(str, options);
}


//-----#
//-----# String
//-----#

function stringifyKey(key, options) {
    return typeof key === `symbol` ? formatSymbol(key, options) : key;
}

function strType(value) {
    return isObj(value) ? Object.prototype.toString.call(value).slice(8, -1) : typeof value;
}


//-----#
//-----# Boolean
//-----#

function isPrototype(value) {
    return isObj(value) && Boolean(value.constructor) && value === value.constructor.prototype;
}

function isArrayOnly(value, length) {
    return Array.isArray(value) && isArrayMinimal(value, length);
}

function isArrayMinimal(value, length) {
    return isArrayLike(value) && value.length === (length ?? Reflect.ownKeys(value).length) - 1;
}

function isArrayLike(value) {
    return isObj(value) && Number.isInteger(value.length) && value.length >= 0;
}

function isIterable(value) {
    return isObj(value) && typeof value[Symbol.iterator] === `function`;
}

function isObj(value) {
    return Boolean(value) && typeof value === `object`;
}

function isGetter(descriptor) {
    return typeof descriptor.get === `function`;
}

function isEmpty(enumerable) {
    for (const _ in enumerable) {
        return false;
    }
    return true;
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
//-----# Combinator.Variadic
//-----#

function thrush(...args) {
    return (func) => func(...args);
}

function compose(...funcs) {
    return (value) => funcs.reduceRight((acc, func) => func(acc), value);
}

function partial(func, ...prepend) {
    return (...args) => func(...prepend, ...args);
}

function curry(func) {
    const num = ({ length }) => length;
    const arity = num(func);
    const sated = (args) => num(args) >= arity;
    const curried = (...args) => sated(args) ? func(...args) : partial(curried, ...args);
    return curried;
}


//-----#
//-----# Combinator.Formal
//-----#

function identity(value) {
    return value;
}

function constant(value) {
    return () => value;
}

function flip(func) {
    return (x) => (y) => func(y)(x);
}


//-----#
//-----# Combinator.Domain
//-----#

function access(key) {
    return (obj) => obj[key];
}

function equals(x) {
    return (y) => x === y;
}

function instanceOf(type) {
    return (value) => value instanceof type;
}

function typeOf(value) {
    return typeof value;
}


//-----#
//-----# Object
//-----#

function createPredicateTable(pairs) {
    const template = ([predicate, forward]) => ({ predicate, forward });
    return pairs.map(template);
};

function makeDispatchTable(pairs, fallback) {
    const truthy = (value) => ({ predicate }) => predicate(value);
    const table = createPredicateTable(pairs);
    return (value) => table.find(truthy(value))?.forward ?? fallback;
};

function createObjectGroups(target, options) {
    const shared = createObjectGroupShared(target, options);
    return {
        GroupKey: partial(createObjectGroupPropertyKey, shared),
        GroupEntry: partial(createObjectGroupPropertyEntry, shared),
        GroupIterator: partial(createObjectGroupIterator, shared),
        GroupPrtype: partial(createObjectGroupPrototype, shared),
    };
}

function createObjectGroupShared(target) {
    const { current } = target.indent.resolve;
    const expander = (format, header, { length } = {}) => {
        const tagHeader = formatCustom(header, target.options.header);
        const tagPrefix = target.indent.reiterate(target.options.header).resolve.current;
        const count = Number.isInteger(length) ? `(${length})` : ``;
        const expanded = format();
        return `${tagPrefix}${tagHeader}${count}${current}${expanded}${current}`;
    };
    const createMutableList = () => {
        const mutableList = [];
        const verify = () => mutableList.length > 0;
        const push = (item) => mutableList.push(item);
        return { mutableList, verify, push };
    };
    return {
        target,
        current,
        expander,
        createMutableList,
    };
}

function createObjectGroupPropertyKey(shared, header, predicate = constant(false)) {
    const {
        target,
        current,
        expander,
        createMutableList,
    } = shared;
    const { mutableList, verify, push } = createMutableList();
    const keyToStr = ({ key, descr }) => formatAny(key) + formatDescriptor(descr, target.options);
    const separate = ({ length }) => length < target.options.newlineLimitGroup ? current : `,`;
    const format = () => mutableList.map(keyToStr).join(separate(mutableList));
    return {
        get expand() {
            return expander(format, header, mutableList);
        },
        get verify() {
            return verify();
        },
        push,
        predicate,
    };
}

function createObjectGroupPropertyEntry(shared, header, predicate = constant(false)) {
    const {
        target,
        current,
        expander,
        createMutableList,
    } = shared;
    const { mutableList, verify, push } = createMutableList();
    const entryToStr = (padding, { length }) => ({ key, value, descr }, index) => {
        const next = Context(value, key, target);
        const expanded = formatAny(next);
        const hasNewline = expanded.includes(`\n`);
        const accessed = formatAny(key).padEnd(hasNewline ? 0 : padding);
        const spacer = hasNewline && index < length - 1 ? current : ``;
        const descriptor = formatDescriptor(descr, target.options);
        return `${accessed} = ${expanded}${descriptor}${spacer}`;
    };
    const longestKey = (max, { key }) => max.length > key.length ? max : key;
    const format = () => {
        const longest = mutableList.reduce(longestKey, ``);
        const padding = formatAny(longest).length;
        const toStr = entryToStr(padding, mutableList);
        return mutableList.map(toStr).join(current);
    };
    return {
        get expand() {
            return expander(format, header, mutableList);
        },
        get verify() {
            return verify();
        },
        push,
        predicate,
    };
}

function createObjectGroupIterator(shared, header) {
    const {
        target,
        current,
        expander,
    } = shared;
    const isIterable = target.receiver[Symbol.iterator] === `function`;
    const iteratorToStr = () => {
        const len = target.receiver.size ?? target.receiver.length ?? 20; // is integer check
        const iterator = target.receiver[Symbol.iterator]();
        const prtypeChain = function recurse(value) {
            if (!isObj(value) || value === Object.prototype) {
                return [];
            }
            return [value].concat(recurse(Object.getPrototypeOf(value)));
        };
        const accessed = formatSymbol(Symbol.iterator, target.options);
        const iterFunc = target.receiver[Symbol.iterator];
        //const iterTarget = new Target(iterFunc, accessed, iterPath, iterIndent);
        const iterContext = Context(iterFunc, accessed, target);
        const expanded = formatAny(iterContext);
        const contentArray = Array.from(iterator.take(len));
        //const contentTarget = new Target(contentArray, accessed, iterPath, iterIndent);
        const contentContext = Context(contentArray, accessed, target);
        // opts: skip origin, add nested element types
        // pass rest of opts after fixing deepMerge Array merge
        const entries = formatAny(contentContext, { originProperty: false });
        const type = formatCustom(iterator, target.options.type);
        const toStrPrtype = (obj) => formatCustom(obj, target.options.prtype);
        const prtypes = prtypeChain(Object.getPrototypeOf(iterator)).map(toStrPrtype).join(`.`);
        const invoked = formatCustom(`invoked-( ${type}.${prtypes} )`, target.options);
        return `${accessed} = ${expanded} ->${current}${invoked} = ${entries}`;
    };
    return {
        get expand() {
            return expander(iteratorToStr, header);
        },
        get verify() {
            return isIterable;
        },
        push: constant(null),
        predicate: constant(false),
    };
}

function createObjectGroupPrototype(shared, header) {
    const {
        target,
        current,
    } = shared;
    /*
    const {
        data,
        options,
    } = target;
    */
    const prtypeToStr = () => {
        const accessed = formatCustom(header, target.options);
        const indent = target.indent.reiterate(target.options.prtype);
        const indentNext = indent.increment(target.options);
        const prtype = Object.getPrototypeOf(target.value);
        const routed = formatCustom(prtype, target.options.prtype);
        const nextMoniker = `${stringifyKey(target.moniker)}.${routed}`;
        const prtypeContext = Context(prtype, nextMoniker, target, target.options, indentNext, target.receiver);
        const expanded = formatAny(prtypeContext, target.options);
        const prepend = indent.resolve.current;
        return `${prepend}${accessed} = ${expanded}${current}`;
    };
    return {
        get expand() {
            return prtypeToStr();
        },
        verify: !target.options.prtype.format.ignore,
        push: constant(null),
        predicate: constant(false),
    };
}


//-----#
//-----# Class
//-----#

//function Context(value, moniker, parent, options, indent) {
const Context = (() => {
    const tag = Symbol();
    /*
    const traceReceiver = (ancestors) => {
        return isPrototype(ancestors[0].value) ? traceReceiver([parent].concat(ancestors)) : ancestors;
    };
    const findReceiver = (value, parent) => {
        return isPrototype(value) ? findReceiver(parent.value, parent.parent) : value;
    };
    */
    function* trace(parent) {
        let step = parent;
        while (isObj(step)) {
            yield step;
            step = step.parent;
        }
    }
    function Context(value, moniker, parent, options, indent, receiver) {
        const cyclicRefDict = parent?.cyclicRefDict ?? new Map();
        const _options = normalizeOptions(options ?? parent?.options);
        const _moniker = stringifyKey(moniker ?? parent?.moniker ?? strType(value));
        const _indent = indent ?? (parent?.indent ?? createIndentation()).increment(_options);
        const traceOrigin = () => {
            const isDone = (value) => !isPrototype(value);
            const pathing = [_moniker];
            let target = parent;
            while (!isDone(target)) {
                pathing.unshift(target.moniker);
                target = target.parent;
            }
            return pathing.join(`.`);
        };
        return {
            [tag]: true,
            value,
            moniker: _moniker,
            parent,
            options: _options,
            indent: _indent,
            traceOrigin,
            cyclicRefDict,
            get receiver() {
                return receiver ?? value;
            },
            get route() {
                return [...trace()]
                    .toReversed()
                    .map(({ moniker }) => moniker)
                    .concat(_moniker)
                    .join(`.`);
            },
        };
    }
    Context.isInstance = (value) => isObj(value) && value[tag];
    return Context;
})();


//-----#
//-----# Options
//-----#

function createDefaultOptions() { // existing object blocklist
    const format = (
        prefix = ``,
        suffix = ``,
        modify = identity,
        ignore = false,
    ) => ({ prefix, suffix, modify, ignore });
    const indent = (
        base = ``,
        fill = ``,
        size = 0,
    ) => ({ base, fill, size });
    const spread = (...setup) => {
        const dict = { format, indent };
        const apply = (fn, rest) => fn(...rest);
        const toEntry = ([name, ...args]) => [name, apply(dict[name] ?? identity, args)];
        const entries = setup.map(toEntry);
        return Object.fromEntries(entries);
    };
    return freezeRecurse({
        newlineLimitGroup: 40,
        newlineLimitArray: 40,
        minimizeSameTypeArray: true,
        originProperty: true,
        format: format(`[`, `]`),
        indent: indent(`|`, ` `, 8),
        object: spread([`format`, `{`, `}`]),
        descriptor: spread([`format`, `'`, ``]),
        origin: spread([`format`, `( `, ` )`]),
        header: spread([`format`, `\\ `, ``], [`indent`, `|`, `¨`, 8]),
        prtype: spread([`format`, `[[`, `]]`, strType], [`indent`, `|`, `-`, 4], [`exclude`, [
            `Object`,
            `Array`,
            `Iterator`,
        ]]),
        type: {
            format: format(`<`, `>`, strType, true),
        },
        error: {
            format: format(`<ERROR>\n`, `\n</ERROR>`),
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
    });
}

function freezeRecurse(obj) {
    if (isObj(obj) && !Object.isFrozen(obj)) {
        Object.freeze(obj);
        Reflect.ownKeys(obj).forEach((key) => freezeRecurse(obj[key]));
    }
    return obj;
}
