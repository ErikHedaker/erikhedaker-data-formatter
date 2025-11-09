'use strict';


//-----#
//-----# TODO
//-----#
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
function formatArray(context) { // Precomputation
    const {
        value,
        moniker,
        options,
        indent,
        traceOrigin,
    } = context;
    const {
        current,
        previous,
    } = indent.resolve;
    const arr = Array.from(value);
    const firstType = strType(arr[0]);
    const isSameType = arr.every(item => strType(item) === firstType);
    const sameline = arr.length >= options.newlineLimitArray;
    const prefix = sameline ? ` ` : current;
    const append = sameline ? ` ` : `,${previous}`;
    const indentItem = sameline ? indent : indent.increment(options);
    const formatItem = (item, index) => {
        const indexed = `${moniker}[${index}]`;
        const next = Context(item, indexed, context, options, indentItem);
        const expanded = formatAny(next);
        return prefix + expanded;
    };
    const expanded = !arr.length ? `` : arr.map(formatItem).join(`,`) + append;
    const origin = !options.originProperty ? `` : formatCustom(traceOrigin(), options.origin);
    const itemType = !isSameType ? `` : `${firstType}: `;
    return `(${itemType}${arr.length})${formatCustom(expanded, options)}${origin}`;
}


//-----#
//-----# Precomputation
//-----#
const createIndentation = (() => {
    const empty = ``;
    const fallback = [`\n`];
    const defaults = normalizeOptions().indent;
    const step = (options) => {
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
    const descrTable = createPredicateTable([
        [propFlag(`writable`), `W`],
        [propFlag(`enumerable`), `E`],
        [propFlag(`configurable`), `C`],
        [propFunc(`get`), `G`],
        [propFunc(`set`), `S`],
    ]);
    const toStrBinder = ({ predicate, forward }) => (descr) => predicate(descr) ? forward : ``;
    const thrushToArr = compose(flip(compose(map, thrush)), map(toStrBinder));
    const thrushToStr = compose(thrush, join(``), thrushToArr(descrTable));
    const isEmptyStr = equals(``);
    const getEmptyStr = constant(``);
    const formatDescrFlip = compose(flip, curry)(formatCustom);
    return function formatDescriptor(descr = {}, options = {}) {
        const format = formatDescrFlip(options.descriptor);
        const invoke = thrushToStr(descr);
        const expand = invoke(isEmptyStr) ? getEmptyStr : format;
        return invoke(expand);
    };
})();
const formatObject = (() => {
    const isTypeExcluded = (value, options) => {
        const excludeTypes = options.prtype.exclude;
        return excludeTypes.some((type) => type === strType(value));
    };
    const propertyWhenError = (key, error) => ({ key, value: error, descr: null });
    const propertyFromKeyThrowable = (key, context) => ({
        key,
        value: Reflect.get(context.value, key, context.receiver),
        descr: Reflect.getOwnPropertyDescriptor(context.value, key),
    });
    const propertyFromKey = (context) => (key) => {
        try {
            return propertyFromKeyThrowable(key, context);
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
    const truthy = (value) => ({ predicate }) => predicate(value);
    const mutateSelectGroup = (groups, fallback) => (property) => {
        const selectGroup = truthy(property);
        const group = groups.find(selectGroup) ?? fallback;
        group.push(property);
    };
    const accessVerify = (group) => group.verify;
    const accessExpand = (group) => group.expand;
    return function formatObject(context) {
        //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
        //unroll iterator, filter keys if items contain keys from object
        const {
            value,
            options,
            indent,
            cyclicRefDict,
            traceOrigin,
            receiver,
        } = context;
        const {
            current,
            previous,
        } = indent.resolve;
        const keys = Reflect.ownKeys(value);
        // Set // add array and iterable keys into Set, filter keys based on that
        const length = keys.length;
        const cyclic = cyclicRefDict.get(value);
        if (Boolean(cyclic)) {
            return `{cyclic}`;
        }
        if (value === Array.prototype) {
            return `{Array.prototype}`;
        }
        if (value === Object.prototype) {
            return `{Object.prototype}`;
        }
        if (value === Iterator.prototype) {
            return `{Iterator.prototype}`;
        }
        if (isArrayOnly(receiver, length)) {
            return formatArray(context);
        }
        const {
            GroupKey,
            GroupEntry,
            GroupIterator,
            GroupPrtype,
        } = createObjectGroups(context);
        const groupPrimitive = GroupEntry(`primitive`);
        const groups = [
            groupPrimitive,
            GroupEntry(`getter`, ({ value, descr }) => value != null && isGetter(descr)),
            GroupIterator(`iterator`),
            GroupEntry(`object`, ({ value }) => isObj(value)),
            GroupEntry(`array`, ({ value }) => isArrayLike(value)), // above object
            GroupKey(`function`, ({ value }) => typeof value === `function`),
            GroupKey(`null`, ({ value }) => value === null),
            GroupKey(`undefined`, ({ value }) => value === undefined),
            GroupPrtype(`__proto__`),
        ];
        const mutateGroup = mutateSelectGroup(groups, groupPrimitive);
        keys.map(propertyFromKey(context)).toSorted(propertySorter).forEach(mutateGroup);
        cyclicRefDict.set(value, traceOrigin());
        const expanded = groups.filter(accessVerify).map(accessExpand).join(``);
        const isEmptyStr = expanded === ``;
        const origin = isEmptyStr ? `` : formatCustom(traceOrigin(), options.origin);
        const prefix = isEmptyStr ? `` : current;
        const suffix = isEmptyStr ? `` : previous;
        const output = formatCustom(prefix + expanded + suffix, options.object);
        return `(${length})${output}${origin}`;
    };
})();
const formatAny = (() => {
    const duplication = (f) => (x) => f(x)(x);
    const converge = (f) => (g) => (h) => (x) => f(g(x))(h(x));
    const defaults = normalizeOptions();
    const Conform = (value) => ({ value, options: defaults });
    const forwardSelector = makeForwardingTable([
        [equals(null), constant(`null`)],
        [instanceOf(Date), constant(`date`)],
        [instanceOf(Error), constant(`error`)],
    ], typeOf);
    const formatters = new Map([
        [`function`, (context) => formatCustom(context.value.name, context.options)],
        [`string`, (context) => formatCustom(`"${context.value}"`, context.options)],
        [`symbol`, (context) => formatCustom(stringifyAccessor(context.value), context.options)],
        [`object`, (context) => formatObject(context, context.options)],
        [`error`, (context) => formatCustom(context.value.stack, context.options.error)],
    ]);
    const fallback = (context) => formatCustom(String(context.value), context.options);
    const selectFormatter = (select) => formatters.get(select) ?? fallback;
    const formatValueType = (context) => formatCustom(context.value, context.options.type);
    return function formatAny(arg) {
        const context = isObj(arg) ? (Context.isInstance(arg) ? arg : Context(arg)) : Conform(arg);
        const selector = forwardSelector(context.value);
        const selected = selector(context.value);
        const format = selectFormatter(selected);
        return formatValueType(context) + format(context);
    };
})();


//-----#
//-----# Mutation
//-----#
function logAny(...args) {
    return logCustom({ type: { format: { ignore: false } } }, console.log, ...args);
}
function logCustom(override, logger, ...args) {
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
//-----# String
//-----#
function formatCustom(value, options) {
    const {
        prefix = ``,
        suffix = ``,
        modify = identity,
        ignore = false,
    } = options?.format ?? {};
    return ignore ? `` : `${prefix}${modify(value)}${suffix}`;
}
function stringifyAccessor(key) {
    function toStr(symbol) {
        const msg = symbol.description;
        return isKnownSymbol(symbol) ? msg : (Boolean(msg) ? `Symbol("${msg}")` : `Symbol()`);
    }
    return typeof key === `symbol` ? toStr(key) : key;
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
}
function makeForwardingTable(pairs, fallback) {
    const truthy = (value) => ({ predicate }) => predicate(value);
    const table = createPredicateTable(pairs);
    return (value) => table.find(truthy(value))?.forward ?? fallback;
}
function createObjectGroups(context) {
    const shared = createObjectGroupShared(context);
    return {
        GroupKey: partial(createObjectGroupPropertyKey, shared),
        GroupEntry: partial(createObjectGroupPropertyEntry, shared),
        GroupIterator: partial(createObjectGroupIterator, shared),
        GroupPrtype: partial(createObjectGroupPrototype, shared),
    };
}
function createObjectGroupShared(context) {
    const {
        options,
        indent,
    } = context;
    const { current } = indent.resolve;
    const tagPrefix = indent.reiterate(options.header).resolve.current;
    const expander = (format, header, { length } = {}) => {
        const tagHeader = formatCustom(header, options.header);
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
        context,
        current,
        expander,
        createMutableList,
    };
}
function createObjectGroupPropertyKey(shared, header, predicate = constant(false)) {
    const {
        context,
        current,
        expander,
        createMutableList,
    } = shared;
    const {
        options,
    } = context;
    const { mutableList, verify, push } = createMutableList();
    const keyToStr = ({ key, descr }) => formatAny(key) + formatDescriptor(descr, options);
    const separate = ({ length }) => length < options.newlineLimitGroup ? current : `,`;
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
        context,
        current,
        expander,
        createMutableList,
    } = shared;
    const {
        options,
    } = context;
    const { mutableList, verify, push } = createMutableList();
    const entryToStr = (padding, { length }) => ({ key, value, descr }, index) => {
        const next = Context(value, key, context);
        const expanded = formatAny(next);
        const hasNewline = expanded.includes(`\n`);
        const accessed = formatAny(key).padEnd(hasNewline ? 0 : padding);
        const spacer = hasNewline && index < length - 1 ? current : ``;
        const descriptor = formatDescriptor(descr, options);
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
        context,
        current,
        expander,
    } = shared;
    const {
        options,
        receiver,
    } = context;
    const isIterable = receiver[Symbol.iterator] === `function`;
    const iteratorToStr = () => {
        const len = receiver.size ?? receiver.length ?? 20; // is integer check
        const iterator = receiver[Symbol.iterator]();
        const prtypeChain = function recurse(value) {
            if (!isObj(value) || value === Object.prototype) {
                return [];
            }
            return [value].concat(recurse(Object.getPrototypeOf(value)));
        };
        const accessed = formatCustom(stringifyAccessor(Symbol.iterator), options);
        const iterFunc = receiver[Symbol.iterator];
        const iterContext = Context(iterFunc, accessed, context);
        const expanded = formatAny(iterContext);
        const contentArray = Array.from(iterator.take(len));
        const contentContext = Context(contentArray, accessed, context);
        // opts: skip origin, add nested element types
        // pass rest of opts after fixing deepMerge Array merge
        const entries = formatAny(contentContext, { originProperty: false });
        const type = formatCustom(iterator, options.type);
        const toStrPrtype = (obj) => formatCustom(obj, options.prtype);
        const prtypes = prtypeChain(Object.getPrototypeOf(iterator)).map(toStrPrtype).join(`.`);
        const invoked = formatCustom(`invoked-( ${type}.${prtypes} )`, options);
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
        context,
        current,
    } = shared;
    const {
        value,
        moniker,
        options,
        indent,
        receiver,
    } = context;
    const prtypeToStr = () => {
        const accessed = formatCustom(header, options);
        const reiterated = indent.reiterate(options.prtype);
        const indentNext = reiterated.increment(options);
        const prepend = reiterated.resolve.current;
        const prtype = Object.getPrototypeOf(value);
        const prtypeName = formatCustom(prtype, options.prtype);
        const prtypeMoniker = `${stringifyAccessor(moniker)}.${prtypeName}`; // test if correct
        const next = Context(prtype, prtypeMoniker, context, options, indentNext, receiver);
        const expanded = formatAny(next, options);
        return `${prepend}${accessed} = ${expanded}${current}`;
    };
    return {
        get expand() {
            return prtypeToStr();
        },
        verify: !options.prtype.format.ignore,
        push: constant(null),
        predicate: constant(false),
    };
}


//-----#
//-----# Class
//-----#
const Context = (() => {
    const tag = Symbol();
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
        const _moniker = stringifyAccessor(moniker ?? parent?.moniker ?? strType(value));
        const _indent = indent ?? (parent?.indent ?? createIndentation()).increment(_options);
        const traceOrigin = () => {
            const isDone = (value) => !isPrototype(value);
            const pathing = [_moniker];
            let step = parent;
            while (!isDone(step)) {
                pathing.unshift(step.moniker);
                step = step.parent;
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
            cyclicRefDict,
            traceOrigin,
            get receiver() {
                return receiver ?? value;
            },
            get route() {
                return [...trace(parent)]
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

export {
    formatAny,
    logAny,
};