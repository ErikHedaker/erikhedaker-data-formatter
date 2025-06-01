'use strict';
export const knownSymbols = Reflect.ownKeys(Symbol).map(
    key => Symbol[key]
).filter(value => typeof value === `symbol`);
export const defaults = {
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
            Array.prototype,
            Iterator.prototype,
        ],
    },
    type: {
        format: {
            ignore: true,
            modify: dataType,
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
const normalized = new Set([defaults]);
export function optionsNormalize(arg) {
    if (!isObj(arg)) {
        return defaults;
    }
    if (normalized.has(arg)) {
        return arg;
    }
    const opts = deepMerge(defaults, arg); // add "known" deepMerge that only merge existing defaults keys
    normalized.add(opts);
    return opts;
}
export function isPrototype(arg) {
    return isObj(arg) && arg === arg.constructor.prototype;
}
export function visit(arg, refs) {
    if (isObj(arg) && !isPrototype(arg)) {
        if (refs.has(arg)) {
            throw `[Problem for current me]`;
        }
        refs.add(arg);
    }
}
export function deepCopy(arg, refs = new Set()) {
    if (isPrototype(arg)) {
        return arg;
    }
    if (isArrayLike(arg)) {
        return Array.from(arg, item => deepCopy(item, refs));
    }
    if (isIterable(arg)) {
        return arg; // shallow copy things like Map
    }
    if (isObj(arg)) {
        visit(arg, refs);
        const copy = {};
        const keys = Reflect.ownKeys(arg);
        for (const key of keys) {
            copy[key] = deepCopy(arg[key]);
        }
        return copy; // return Reflect.ownKeys(arg).reduce
    }
    return arg;
}
export function deepMerge(baseline, override, visited = new Map()) {
    const copy = {}; // add shallow copy rule
    // pass fn closure of "visit" with visited Map instead of object, init if nullish
    // const mutate = Boolean(visited) ? visited : (map => obj => ...)(new Map())
    if (!visited.has(baseline)) {
        visited.set(baseline, new Set());
    }
    if (!visited.has(override)) {
        visited.set(override, new Set());
    }
    visit(baseline, visited.get(baseline));
    visit(override, visited.get(override));
    if (isPrototype(override)) {
        return override;
    }
    if (isObj(override) && isObj(baseline) && !isPrototype(baseline)) {
        const both = new Set([ // Add logic for merging two arrays and output one Array
            ...Reflect.ownKeys(baseline),
            ...Reflect.ownKeys(override),
        ]);
        for (const key of both) {
            copy[key] = key in override
                ? deepMerge(baseline[key], override[key], visited)
                : deepCopy(baseline[key], visited.get(baseline));
        }
        return copy;
    }
    if (isObj(override)) {
        const keys = Reflect.ownKeys(override);
        for (const key of keys) {
            copy[key] = deepCopy(override[key], visited.get(override));
        }
        return copy;
    }
    if (override === undefined && isObj(baseline) && !isPrototype(baseline)) {
        const keys = Reflect.ownKeys(baseline);
        for (const key of keys) {
            copy[key] = deepCopy(baseline[key], visited.get(baseline));
        }
        return copy;
    }
    if (override === undefined) {
        return baseline;
    }
    return override;
}
export function log(...args) {
    logCustom({ type: { format: { ignore: false } } }, ...args);
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
            const prepend = captured ? `${format(name)} = ` : ``;
            const expanded = format(new Target(data, name, [name], indent.next(opts)), opts, expObj);
            return `${spacer}[${num}]: ${prepend}${expanded}`;
        } catch (error) {
            return `${spacer}[${num}]: ${format(error)}`;
        }
    }).join(``);
    console.log(header + output);
    // make objDone to Map, filter all entries above 1, print last
}
export function format(arg, options, expObj) {
    const opts = optionsNormalize(options); // move to formatObject
    const target = Target.normalize(arg);
    const { data } = target;
    const type = formatCustom(data, opts.type);
    const dispatch = [
        //asynciterable (await with timeout)
        //Promise (.then)
        //toJSON
        //HTMLAllCollection
        [`null`, data === null],
        [`date`, data instanceof Date],
        [`error`, data instanceof Error],
    ].find(([, predicate]) => predicate)?.[0] ?? typeof data;
    const expanded = ({
        function: () => formatCustom(data.name, opts),
        string: () => formatCustom(`"${data}"`, opts),
        symbol: () => formatSymbol(data, opts),
        object: () => formatObject(target, opts, expObj),
    })[dispatch]?.() ?? formatCustom(String(data), opts);
    return type + expanded;
}
export function formatObject(target, options, expObj = new Map()) {
    //const unrolled = Array.from(receiver[Symbol.iterator]().take(receiver.size || receiver.length || 50));
    //unroll iterator, filter keys if items contain keys from object
    const opts = optionsNormalize(options);
    const { data, name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const keys = Reflect.ownKeys(data); // Set // add array and iterable keys into Set, filter keys based on that
    const length = keys.length;
    const ptype = Object.getPrototypeOf(data);
    const ptypeRef = expObj.get(ptype);
    const objRef = expObj.get(data);
    const isExcluded = arg => opts.ptype.exclude.some(obj => obj === arg);
    const filtered = () => formatCustom(`is-filtered`, opts.object);
    const formatCopyOf = ([path]) => (
        str => formatCustom(current + str + previous, opts.object)
    )(`is-copy-of-( ${path.join(`.`)} )`);
    const copyOf = paths => () => (paths.push(path), formatCopyOf(paths));
    const formatEarlyReturn = [
        [filtered, isExcluded(data)],
        [filtered, isExcluded(ptype) && !length],
        [copyOf(objRef), Boolean(objRef)],
        [copyOf(ptypeRef), Boolean(ptypeRef) && !length],
        [() => formatArray(target, opts, expObj), isArrayOnly(receiver, length)],
    ].find(([, predicate]) => predicate)?.[0];
    if (Boolean(formatEarlyReturn)) {
        return formatEarlyReturn();
    }
    const isArrayItem = (isParentArray =>
        ([key]) => isParentArray && parseInt(String(key)) >= 0
    )(isArrayLike(receiver));
    const groups = createObjectGroups([
        [`GroupPropertyEntry`, `primitive`],
        [`GroupPropertyEntry`, `getter`, ({ value, descr }) => value != null && isGetter(descr)],
        [`GroupIterator`],
        [`GroupPropertyEntry`, `object`, ({ value }) => isObj(value)],
        [`GroupPropertyEntry`, `array`, ({ value }) => isArrayLike(value)],
        [`GroupPropertyKey`, `function`, ({ value }) => typeof value === `function`],
        [`GroupPropertyKey`, `null`, ({ value }) => value === null],
        [`GroupPropertyKey`, `undefined`, ({ value }) => value === undefined],
        [`GroupPrototype`],
    ], target, options, expObj);
    const ternaryCmp = (a, b) => a === b ? 0 : a > b ? 1 : -1;
    const selectGroup = (fallback => property => groups.find(
        group => group.predicate(property)
    ) ?? fallback)(groups[0]);
    expObj.set(data, [path]);
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
    }).toSorted((lhs, rhs) => {
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
    }).forEach(property => selectGroup(property).push(property));
    const expanded = groups.filter(group => group.verify).map(group => group.expand).join(``);
    const [prepend, append, origin] = !expanded.includes(`\n`) ? [``, ``, ``] :
        [current, previous, formatCustom(data === receiver ? target.pathResolve() : name, opts.origin)];
    return `(${length})${formatCustom(prepend + expanded + append, opts.object)}${origin}`;
}
export function createObjectGroups(setup, target, options, expObj) {
    const opts = optionsNormalize(options);
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
    };
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
    };
    const returnTypes = {
        GroupPropertyKey: class extends GroupProperty {
            constructor(...args) {
                super(...args);
            }
            formatter() {
                const newline = this.mutablePropertyList.length < opts.newlineLimitGroup;
                return this.mutablePropertyList.map(({ key, descr }) =>
                    format(key) + formatDescriptor(descr, opts)
                ).join(newline ? current : `,`);
            }
        },
        GroupPropertyEntry: class extends GroupProperty {
            constructor(...args) {
                super(...args);
            }
            formatter() {
                const longest = (max, { key }) => max.length > key.length ? max : key;
                const padding = format(this.mutablePropertyList.reduce(longest, ``)).length;
                return this.mutablePropertyList.map(({ key, value, descr }, index) => {
                    const expanded = format(new Target(
                        value, key, path.concat(keyStr(key)), indent.next(opts)
                    ), opts, expObj);
                    const hasNewline = expanded.includes(`\n`);
                    const accessed = format(key).padEnd(hasNewline ? 0 : padding);
                    const spacer = hasNewline && index < this.mutablePropertyList.length - 1 ? current : ``;
                    return `${accessed} = ${expanded}${formatDescriptor(descr, opts)}${spacer}`;
                }).join(current);
            }
        },
        GroupPrototype: class extends GroupBase {
            get verify() {
                return !opts.ptype.format.ignore;
            }
            get expand() {
                const objPtype = Object.getPrototypeOf(data);
                const strPtype = formatCustom(objPtype, opts.ptype);
                const indPtype = indent.with(-1, opts.ptype);
                const accessed = formatCustom(`__proto__`, opts);
                const expanded = format(new Target(
                    objPtype, `${keyStr(name)}.${strPtype}`, path.concat(strPtype), indPtype.next(opts), receiver
                ), opts, expObj);
                return `${indPtype.resolve.current}${accessed} = ${expanded}${current}`;
            }
        },
        GroupIterator: class extends GroupBase {
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
                const size = receiver.size ?? receiver.length ?? 20;
                const iter = receiver[Symbol.iterator]();
                const next = indent.next(opts);
                const prtypeObj = arg => isObj(arg) && arg !== Object.prototype ? [arg].concat(
                    prtypeObj(Object.getPrototypeOf(arg))
                ) : [];
                const accessed = formatSymbol(Symbol.iterator, opts);
                const expanded = format(new Target(
                    receiver[Symbol.iterator], accessed, path.concat(accessed), next
                ), opts, expObj);
                const entries = format(new Target( // opts: skip origin, add nested element types
                    Array.from(iter.take(size)), accessed, path.concat(accessed), next
                ), { originProperty: false }, expObj); // pass rest of opts after fixing deepMerge Array merge
                const type = formatCustom(iter, opts.type);
                const prtypes = prtypeObj(Object.getPrototypeOf(iter)).map(
                    obj => formatCustom(obj, opts.ptype)
                ).join(`.`);
                const invoked = formatCustom(`invoked-( ${type}.${prtypes} )`, opts);
                return `${accessed} = ${expanded} ->${current}${invoked} = ${entries}`;
            }
        },
    };
    return setup.map(([type, ...args]) => new returnTypes[type](...args));
}
export function formatArray(target, options, expObj) {
    const opts = optionsNormalize(options);
    const { name, path, indent, receiver } = target;
    const { current, previous } = indent.resolve;
    const arr = Array.from(receiver);
    const firstType = dataType(arr[0]);
    const isSameType = arr.every(item => dataType(item) === firstType);
    const newline = arr.length < opts.newlineLimitArray;
    const [prefix, append] = !newline ? [` `, ` `] : [current, `,${previous}`];
    const formatItem = (item, indexed) => format(new Target(
        item, indexed, path.concat(indexed), newline ? indent.next(opts) : indent
    ), opts, expObj);
    const expanded = !arr.length ? `` : arr.map(
        (item, index) => prefix + formatItem(item, `${name}[${index}]`)
    ).join(`,`) + append;
    const origin = !opts.originProperty ? `` : formatCustom(target.pathResolve(), opts.origin);
    const itemType = !isSameType ? `` : `${firstType}: `;
    return `(${itemType}${arr.length})${formatCustom(expanded, opts)}${origin}`;
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
    ].filter(([, predicate]) => predicate).map(([value]) => value).join(``);
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
export function isArrayOnly(arg, length) {
    return Array.isArray(arg) && isArrayMinimal(arg, length);
}
export function isArrayMinimal(arg, length) {
    return isArrayLike(arg) && arg.length === (length ?? Reflect.ownKeys(arg).length) - 1;
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