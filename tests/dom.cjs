class Element {
    constructor(tag = 'div') {
        this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.attributes = {};
        this.value = ''; this.hidden = false; this.disabled = false; this.listeners = {}; this.className = ''; this._text = '';
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/), ...names])].join(' ').trim(); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(n => !names.includes(n)).join(' '); },
            toggle: (name, force) => { const on = force ?? !this.classList.contains(name); this.classList[on ? 'add' : 'remove'](name); return on; }
        };
    }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; this._html = ''; }
    set innerHTML(value) { this._html = value; this._text = ''; this.children = []; parse(value, this); }
    get innerHTML() { return this._html || ''; }
    append(...children) { children.forEach(c => this.appendChild(c)); }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
    setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'class') this.className = value; if (key === 'id') this.id = value; if (key.startsWith('data-')) this.dataset[key.slice(5)] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(event, fn) { this.listeners[event] = fn; }
    querySelectorAll(selector) {
        const parts = selector.split(' ');
        const match = (el, part) => { if (part === '[data-route]') return !!el.dataset.route; if (part.includes('[') && !part.startsWith('[')) { const [tag, rest] = part.split('['); const [key,val] = rest.replace(']','').replaceAll('\"','').split('='); return el.tagName === tag && el.attributes[key] === val; } return part[0] === '#' ? el.id === part.slice(1) : part[0] === '.' ? el.classList.contains(part.slice(1)) : part === '[data-view]' ? !!el.dataset.view : el.tagName === part; };
        const nodes = [];
        const walk = node => node.children.forEach(child => { nodes.push(child); walk(child); }); walk(this);
        return nodes.filter(node => {
            if (!match(node, parts.at(-1))) return false;
            let ancestor = node.parent;
            for (let i = parts.length - 2; i >= 0; i--) {
                while (ancestor && !match(ancestor, parts[i])) ancestor = ancestor.parent;
                if (!ancestor) return false;
                ancestor = ancestor.parent;
            }
            return true;
        });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    insertRow() { return this.appendChild(new Element('tr')); }
    insertCell() { return this.appendChild(new Element('td')); }
    createTHead() { return this.appendChild(new Element('thead')); }
    createTBody() { return this.appendChild(new Element('tbody')); }
    scrollIntoView() {}
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
}
function parse(markup, root) {
    const stack = [root];
    const voids = new Set(['meta','link','input','br','hr','img']);
    for (const token of markup.matchAll(/<!--[\s\S]*?-->|<\/?([\w-]+)\b([^>]*)>|([^<]+)/g)) {
        if (!token[1]) { if (token[3]) stack.at(-1)._text += token[3]; continue; }
        const tag = token[1];
        if (token[0].startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
        const el = new Element(tag);
        for (const attr of token[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) el.setAttribute(attr[1], attr[2] ?? '');
        el.hidden = Object.hasOwn(el.attributes, 'hidden');
        el.disabled = Object.hasOwn(el.attributes, 'disabled');
        stack.at(-1).appendChild(el);
        if (!voids.has(tag)) stack.push(el);
    }
}

module.exports = { Element, parse };
