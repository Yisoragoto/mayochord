/**
 * 极简 XML 解析（MusicXML 用）：元素、属性、文本、CDATA、注释、处理指令、DOCTYPE、
 * 预定义实体与数字字符引用。不处理命名空间与 DTD 里自定义的实体。
 * core 不依赖浏览器 API（没有 DOMParser），所以自己写；解析失败抛 XmlError。
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** 直接包含的文字（子元素里的不算），已解码实体、未去空白 */
  text: string;
}

export class XmlError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(`${message} (at ${position})`);
    this.name = 'XmlError';
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decode(s: string, at: number): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (_, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    const v = ENTITIES[ref];
    if (v === undefined) throw new XmlError(`Unknown entity &${ref};`, at);
    return v;
  });
}

const NAME_RE = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const ATTR_RE = /\s*([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/y;

/** 解析 XML 文本，返回根元素。 */
export function parseXml(src: string): XmlElement {
  let i = src.charCodeAt(0) === 0xfeff ? 1 : 0;
  const stack: XmlElement[] = [];
  let root: XmlElement | null = null;

  const skip = (end: string, what: string) => {
    const j = src.indexOf(end, i);
    if (j < 0) throw new XmlError(`Unterminated ${what}`, i);
    i = j + end.length;
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    const textEnd = lt < 0 ? src.length : lt;
    if (textEnd > i) {
      const text = src.slice(i, textEnd);
      const top = stack[stack.length - 1];
      if (top) top.text += decode(text, i);
      else if (text.trim()) throw new XmlError('Text outside the root element', i);
      i = textEnd;
      continue;
    }
    if (src.startsWith('<!--', i)) skip('-->', 'comment');
    else if (src.startsWith('<![CDATA[', i)) {
      const j = src.indexOf(']]>', i);
      if (j < 0) throw new XmlError('Unterminated CDATA', i);
      const top = stack[stack.length - 1];
      if (top) top.text += src.slice(i + 9, j);
      i = j + 3;
    } else if (src.startsWith('<?', i)) skip('?>', 'processing instruction');
    else if (src.startsWith('<!DOCTYPE', i)) {
      // 可能带内部子集 [...]
      const bracket = src.indexOf('[', i);
      const close = src.indexOf('>', i);
      if (close < 0) throw new XmlError('Unterminated DOCTYPE', i);
      if (bracket >= 0 && bracket < close) {
        i = bracket;
        skip(']', 'DOCTYPE');
        skip('>', 'DOCTYPE');
      } else i = close + 1;
    } else if (src.startsWith('</', i)) {
      NAME_RE.lastIndex = i + 2;
      const m = NAME_RE.exec(src);
      const top = stack.pop();
      if (!m || !top || top.name !== m[0]) throw new XmlError('Mismatched closing tag', i);
      i = NAME_RE.lastIndex;
      skip('>', 'closing tag');
    } else {
      NAME_RE.lastIndex = i + 1;
      const m = NAME_RE.exec(src);
      if (!m) throw new XmlError('Invalid tag', i);
      const el: XmlElement = { name: m[0], attrs: {}, children: [], text: '' };
      i = NAME_RE.lastIndex;
      for (;;) {
        ATTR_RE.lastIndex = i;
        const a = ATTR_RE.exec(src);
        if (!a) break;
        el.attrs[a[1] as string] = decode(a[3] ?? a[4] ?? '', i);
        i = ATTR_RE.lastIndex;
      }
      while (i < src.length && /\s/.test(src[i] as string)) i++;
      const parent = stack[stack.length - 1];
      if (parent) parent.children.push(el);
      else if (root) throw new XmlError('Multiple root elements', i);
      else root = el;
      if (src.startsWith('/>', i)) i += 2;
      else if (src[i] === '>') {
        i += 1;
        stack.push(el);
      } else throw new XmlError('Malformed tag', i);
    }
  }
  if (stack.length) throw new XmlError(`Unclosed <${stack[stack.length - 1]?.name}>`, i);
  if (!root) throw new XmlError('No root element', 0);
  return root;
}

/** 第一个名为 name 的子元素 */
export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c) => c.name === name);
}

/** 所有名为 name 的子元素 */
export function childrenNamed(el: XmlElement | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === name) : [];
}

/** 子元素的文字（去空白）；没有时为 undefined */
export function childText(el: XmlElement | undefined, name: string): string | undefined {
  const c = child(el, name);
  return c ? c.text.trim() : undefined;
}

/** 子元素的数字；没有或不是数字时为 undefined */
export function childNumber(el: XmlElement | undefined, name: string): number | undefined {
  const t = childText(el, name);
  if (t === undefined || t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
