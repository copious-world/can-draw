function noop() { }
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function is_empty(obj) {
    return Object.keys(obj).length === 0;
}
function append(target, node) {
    target.appendChild(node);
}
function append_styles(target, style_sheet_id, styles) {
    const append_styles_to = get_root_for_style(target);
    if (!append_styles_to.getElementById(style_sheet_id)) {
        const style = element('style');
        style.id = style_sheet_id;
        style.textContent = styles;
        append_stylesheet(append_styles_to, style);
    }
}
function get_root_for_style(node) {
    if (!node)
        return document;
    const root = node.getRootNode ? node.getRootNode() : node.ownerDocument;
    if (root && root.host) {
        return root;
    }
    return node.ownerDocument;
}
function append_stylesheet(node, style) {
    append(node.head || node, style);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function element(name) {
    return document.createElement(name);
}
function attr(node, attribute, value) {
    if (value == null)
        node.removeAttribute(attribute);
    else if (node.getAttribute(attribute) !== value)
        node.setAttribute(attribute, value);
}
function children(element) {
    return Array.from(element.childNodes);
}

let current_component;
function set_current_component(component) {
    current_component = component;
}

const dirty_components = [];
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
let flushing = false;
const seen_callbacks = new Set();
function flush() {
    if (flushing)
        return;
    flushing = true;
    do {
        // first, call beforeUpdate functions
        // and update components
        for (let i = 0; i < dirty_components.length; i += 1) {
            const component = dirty_components[i];
            set_current_component(component);
            update(component.$$);
        }
        set_current_component(null);
        dirty_components.length = 0;
        while (binding_callbacks.length)
            binding_callbacks.pop()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        for (let i = 0; i < render_callbacks.length; i += 1) {
            const callback = render_callbacks[i];
            if (!seen_callbacks.has(callback)) {
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
                callback();
            }
        }
        render_callbacks.length = 0;
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
    flushing = false;
    seen_callbacks.clear();
}
function update($$) {
    if ($$.fragment !== null) {
        $$.update();
        run_all($$.before_update);
        const dirty = $$.dirty;
        $$.dirty = [-1];
        $$.fragment && $$.fragment.p($$.ctx, dirty);
        $$.after_update.forEach(add_render_callback);
    }
}
const outroing = new Set();
function transition_in(block, local) {
    if (block && block.i) {
        outroing.delete(block);
        block.i(local);
    }
}
function mount_component(component, target, anchor, customElement) {
    const { fragment, on_mount, on_destroy, after_update } = component.$$;
    fragment && fragment.m(target, anchor);
    if (!customElement) {
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
    }
    after_update.forEach(add_render_callback);
}
function destroy_component(component, detaching) {
    const $$ = component.$$;
    if ($$.fragment !== null) {
        run_all($$.on_destroy);
        $$.fragment && $$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        $$.on_destroy = $$.fragment = null;
        $$.ctx = [];
    }
}
function make_dirty(component, i) {
    if (component.$$.dirty[0] === -1) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty.fill(0);
    }
    component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
}
function init(component, options, instance, create_fragment, not_equal, props, append_styles, dirty = [-1]) {
    const parent_component = current_component;
    set_current_component(component);
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props,
        update: noop,
        not_equal,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        on_disconnect: [],
        before_update: [],
        after_update: [],
        context: new Map(options.context || (parent_component ? parent_component.$$.context : [])),
        // everything else
        callbacks: blank_object(),
        dirty,
        skip_bound: false,
        root: options.target || parent_component.$$.root
    };
    append_styles && append_styles($$.root);
    let ready = false;
    $$.ctx = instance
        ? instance(component, options.props || {}, (i, ret, ...rest) => {
            const value = rest.length ? rest[0] : ret;
            if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                if (!$$.skip_bound && $$.bound[i])
                    $$.bound[i](value);
                if (ready)
                    make_dirty(component, i);
            }
            return ret;
        })
        : [];
    $$.update();
    ready = true;
    run_all($$.before_update);
    // `false` as a special case of no DOM component
    $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
    if (options.target) {
        if (options.hydrate) {
            const nodes = children(options.target);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.l(nodes);
            nodes.forEach(detach);
        }
        else {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            $$.fragment && $$.fragment.c();
        }
        if (options.intro)
            transition_in(component.$$.fragment);
        mount_component(component, options.target, options.anchor, options.customElement);
        flush();
    }
    set_current_component(parent_component);
}
/**
 * Base class for Svelte components. Used when dev=false.
 */
class SvelteComponent {
    $destroy() {
        destroy_component(this, 1);
        this.$destroy = noop;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set($$props) {
        if (this.$$set && !is_empty($$props)) {
            this.$$.skip_bound = true;
            this.$$set($$props);
            this.$$.skip_bound = false;
        }
    }
}

const subscriber_queue = [];
/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = new Set();
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (stop) { // store is ready
                const run_queue = !subscriber_queue.length;
                for (const subscriber of subscribers) {
                    subscriber[1]();
                    subscriber_queue.push(subscriber, value);
                }
                if (run_queue) {
                    for (let i = 0; i < subscriber_queue.length; i += 2) {
                        subscriber_queue[i][0](subscriber_queue[i + 1]);
                    }
                    subscriber_queue.length = 0;
                }
            }
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.add(subscriber);
        if (subscribers.size === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            subscribers.delete(subscriber);
            if (subscribers.size === 0) {
                stop();
                stop = null;
            }
        };
    }
    return { set, update, subscribe };
}

let g_commander = writable(false);

class Drawing {

    constructor() {
        this.layers = [];
    }

    add(shape,parameters) {
        g_commander.update( cmd => {
            let command = {
                "shape" : shape,
                "pars" : parameters
            };
            return command
        });
    }

    command(action,parameters) {
        g_commander.update( cmd => {
            let command = {
                "command" : action,
                "pars" : parameters
            };
            return command
        });
    }

    update(parameters) {
        g_commander.update( cmd => {
            let command = {
                "update" : true,
                "pars" : parameters
            };
            return command
        });
    }

    searching(parameters) {
        g_commander.update( cmd => {
            let command = {
                "searching" : true,
                "pars" : parameters
            };
            return command
        });
    }
}

let g_drawing_set = {
    "current_drawing" : null,
    "current_drawing_name" : "",
    "drawings" : {}
};


function set_drawing(name) {
    if ( g_drawing_set.current_drawing !== null ) {
        g_drawing_set.drawings[g_drawing_set.current_drawing_name] = g_drawing_set.current_drawing;
    }
    g_drawing_set.current_drawing_name = name;
    g_drawing_set.current_drawing = new Drawing();
    return g_drawing_set.current_drawing
}

var draw_model = /*#__PURE__*/Object.freeze({
    __proto__: null,
    g_commander: g_commander,
    set_drawing: set_drawing
});

/**
 * @param {Float} n angle
 * @return {Float} cotangeante
 */
const cot = (n) => 1 / Math.tan(n);

/**
 * @param {Float} n angle
 * @returns {Float} sec
 */
const sec = (n) => 1 / Math.cos(n);

const circle_bounding_rect = (centerX, centerY, radius) => {
    let left = centerX  - radius;
    let top = centerY - radius;
    let width = 2*radius;
    let height = 2*radius;
    return [left,top,width,height]
};

const ellipse_bounding_rect = (centerX, centerY, rad1, rad2) => {
    let left = centerX  - rad1;
    let top = centerY - rad2;
    let width = 2*rad1;
    let height = 2*rad2;
    return [left,top,width,height]
};


const text_box = (ctxt,txt) => {
    const textMetrics = ctxt.measureText(txt);
    let w = Math.abs(textMetrics.actualBoundingBoxLeft) +
            Math.abs(textMetrics.actualBoundingBoxRight);
    let top = textMetrics.actualBoundingBoxAscent;
    let h = top + Math.abs(textMetrics.actualBoundingBoxDescent);
    return [w,h,top]
};

const update_bounds = (descriptor,x_up,y_up) => {
    if ( descriptor ) {
        let [x,y,w,h] = descriptor.bounds;
        if ( x_up < x ) {
            w += x - x_up;
            x = x_up;
        } else if ( x_up > (x + w) ) {
            w = x_up - x;
        }
        if ( y_up < y ) {
            h += y - y_up;
            y = y_up;
        } else if ( y_up > (y + h) ) {
            h = y_up - y;
        }
        descriptor.bounds = [x,y,w,h];
    }
};


const _rect_path = (descriptor,x1,y1,w,h) => {
    const rect_P = new Path2D();
    rect_P.rect(x1,y1,w,h);
    descriptor.path = rect_P;    
};

const _circle_path = (descriptor,centerX,centerY,radius) => {
    if ( radius <= 0 ) return
    const circle_P = new Path2D();
    circle_P.arc(centerX, centerY, radius, 0, (2*Math.PI));
    descriptor.path = circle_P;    
};

const _ellipse_path = (descriptor,centerX,centerY,rad1,rad2,rotate) => {
    if ( rad1 <= 0 ) return
    if ( rad2 <= 0 ) return
    const ellipse_P = new Path2D();
    ellipse_P.ellipse(centerX, centerY, rad1, rad2, rotate, 0, (2 * Math.PI));
    descriptor.path = ellipse_P;
};

const _line_path = (descriptor,x1,y1,x2,y2) => {
    const line_P = new Path2D();
    line_P.moveTo(x1,y1+5);
    line_P.lineTo(x1,y1-5);
    line_P.lineTo(x2,y2-5);
    line_P.lineTo(x1,y1-5);
    line_P.lineTo(x1,y1+5);
    line_P.closePath();
    descriptor.path = line_P;
};

const _text_path = (descriptor) => {
    let [x,y,w,h] = descriptor.bounds;
    _rect_path(descriptor,x,y,w,h);
};

const _path_path = (descriptor) => {
    let points = descriptor.points;
    const path_P = new Path2D();
    let s = points.length;
    for ( let i = 0; i < s; i++ ) {
        let p = points[i];
        let x = p[0];
        let y = p[0];
        if ( i == 0 ) {
            path_P.moveTo(x,y);
        } else {
            path_P.lineTo(x,y);
        }
    }
    path_P.closePath();
    descriptor.path = path_P;
};

class ZList {

    // 
    constructor() {
        this.z_list = [];
        this.redrawing = false;
        this.selected = 0;
        this._selected_object = false;
        this._redraw_descriptor = false;
    }

    select(ith) {
        if ( (ith >= 0) && (ith < this.z_list.length) ) {
            this.selected = ith;
        }
    }

    selected_object() {
        if ( (this.selected >= 0) && (this.selected < this.z_list.length) ) {
            this._selected_object = this.z_list[this.selected];
            return this._selected_object
        }
        return false
    }

    selected_to_bottom() {
        if ( (this.selected >= 0) && (this.selected < this.z_list.length )) {
            let el = this.z_list[this.selected];
            this.z_list.splice(this.selected,1);
            this.z_list.unshift(el);
            this.selected = 0;
        }
    }

    selected_to_top() {
        if ( (this.selected >= 0) && (this.selected < this.z_list.length )) {
            let el = this.z_list[this.selected];
            this.z_list.splice(this.selected,1);
            this.z_list.push(el);
            this.selected = this.z_list.length - 1;
        }
    }

    push(pars) {
        if ( !(this.redrawing) ) {
            this.z_list.push(pars);
            this.selected = (this.z_list.length - 1);
        }
    }

    pop() {
        this.z_list.pop();
    }

    reverse() {
        let old_z = this.z_list;
        this.z_list = old_z.reverse();
    }

    clear_z() {
        this.z_list = [];
    }

    z_top() {
        return (this.z_list.length - 1)
    }
}

class DrawTools extends ZList {

    //
    constructor(ctxt,width,height) {
        super();
        this.ctxt = ctxt;
        this.width = width;
        this.height = height;
        this.scale_x = 1.0;
        this.scale_y = 1.0;
    }

    setContext(ctxt) {
        this.ctxt = ctxt;
    }

    clear() {
        if ( this.ctxt ) {
            this._scale();
            this.ctxt.clearRect(0,0,this.width,this.height);
            this._unscale();
        }
    }

    clear_all() {
        this.clear_z();
        this.clear();
    }


    _scale() {
        let ctxt = this.ctxt;
        if ( ctxt ) {
            ctxt.scale(this.scale_x,this.scale_y);
        }
    }

    _unscale() {
        let ctxt = this.ctxt;
        if ( ctxt ) {
            ctxt.scale((1.0/this.scale_x),(1.0/this.scale_y));
        }
    }


    //
    _lines_and_fill(ctxt,pars,path) {
        if ( pars.fill !== "none" ) {
            ctxt.fillStyle = pars.fill;
            if ( path ) ctxt.fill(path,"evenodd");
            else ctxt.fill();
        }
        if ( pars.line !== "none" ) {
            ctxt.lineWidth = pars.thick;
            ctxt.strokeStyle = pars.line;
            if ( path ) ctxt.stroke(path);
            else ctxt.stroke();
        }
    }
    
    
    _descriptor(shape,pars) {
        if ( this._redraw_descriptor ) return this._redraw_descriptor
        else {
            let descriptor = { "shape" : shape, "pars" : pars, "bounds" : [] };
            this.push(descriptor);
            return descriptor    
        }
    }

    text_rect(text,x,y) {
        let ctxt = this.ctxt;
        if ( ctxt ) {
            let [w,h,top] = text_box(ctxt,text);
            return [x,y-top,w,h]
        }
        return descriptor.bounds
    }


     //
     rect(pars) {
        if ( !pars ) return
        if ( this.ctxt ) {
            this._scale();
            let descriptor = this._descriptor("rect",pars);
            let ctxt = this.ctxt;
            let [x1,y1,w,h] = pars.points;
            //
            _rect_path(descriptor,x1,y1,w,h);
            //
            if ( pars.line && (pars.line !== "none") ) {
                ctxt.lineWidth = pars.thick;
                ctxt.strokeStyle = pars.line;
                ctxt.strokeRect(x1,y1,w,h);
            }
            if ( pars.fill && (pars.fill !== "none") ) {
                ctxt.fillStyle = pars.fill;
                ctxt.fillRect(x1,y1,w,h);
            }
            descriptor.bounds = [x1,y1,w,h];
            this._unscale();
        }
    }

    //
    circle(pars) {
        if ( !pars ) return
        if ( this.ctxt ) {
            this._scale();
            let descriptor = this._descriptor("circle",pars);
            let ctxt = this.ctxt;
            let [centerX, centerY, radius] = pars.points;
            if ( radius <= 0 ) {
                this._unscale();
                return
            }
            //
            _circle_path(descriptor,centerX,centerY,radius);
            //
            ctxt.beginPath();
            ctxt.arc(centerX, centerY, radius, 0, 2 * Math.PI, false);
            this._lines_and_fill(ctxt,pars);
            descriptor.bounds = circle_bounding_rect(centerX, centerY, radius);
            this._unscale();
        }
    }


    //
    ellipse(pars) {
        if ( !pars ) return
        if ( this.ctxt ) {
            this._scale();
            let descriptor = this._descriptor("ellipse",pars);
            let ctxt = this.ctxt;
            let [centerX, centerY, rad1, rad2, rotate] = pars.points;
            if ( rad1 <= 0 ) { this._unscale(); return }
            if ( rad2 <= 0 ) { this._unscale(); return }
            _ellipse_path(descriptor,centerX,centerY,rad1,rad2,rotate);
            ctxt.beginPath();
            ctxt.ellipse(centerX, centerY, rad1, rad2, rotate, 0, 2 * Math.PI);
            this._lines_and_fill(ctxt,pars);
            descriptor.bounds = ellipse_bounding_rect(centerX, centerY, rad1, rad2);
            this._unscale();
        }
    }

    //
    line(pars) {
        if ( !pars ) return
        if ( this.ctxt ) {
            let descriptor = this._descriptor("line",pars);
            let ctxt = this.ctxt;
            let [x1,y1,x2,y2] = pars.points;
            descriptor.bounds = [x1,y1,(x2 - x1),(y2 - y1)];
            //
            if ( pars.line !== "none" ) {
                this._scale();
                _line_path(descriptor,x1,y1,x2,y2);
                ctxt.beginPath();
                ctxt.lineWidth = pars.thick;
                ctxt.strokeStyle = pars.line;
                ctxt.moveTo(x1,y1);
                ctxt.lineTo(x2,y2);
                ctxt.stroke();
                this._unscale();
            }

        }
    }


    //
    text(pars) {
        if ( !pars ) return
        if ( this.ctxt ) {
            this._scale();
            let descriptor = this._descriptor("text",pars);
            let ctxt = this.ctxt;
            let [x,y] = pars.points;
            let text = pars.text;
            //
            ctxt.beginPath();
            ctxt.font = pars.font;
            ctxt.textAlign = pars.textAlign;
            ctxt.textBaseline = pars.textBaseline;
            //
            if ( pars.line && (pars.line !== "none") ) {
                ctxt.lineWidth = pars.thick;
                ctxt.strokeStyle = pars.line;
                ctxt.strokeText(text, x, y);
            }
            if ( pars.fill && (pars.fill !== "none") ) {
                ctxt.fillStyle = pars.fill;
                ctxt.fillText(text, x, y);
            }
            descriptor.bounds = this.text_rect(text,x,y);
            _text_path(descriptor);
            this._unscale();
        }

    }


    //
    polygon(pars) {
        if ( !pars ) return
        if ( this.ctxt ) {
            this._scale();
            let descriptor = this._descriptor("polygon",pars);
            let ctxt = this.ctxt;
            let [cx,cy,rad] = pars.points;
            let sides = pars.sides;

            ctxt.beginPath();
            let region = new Path2D();
            //
            const edg = (rad / 1.5);
            const inradius = (edg / 2) * cot(Math.PI / sides);
            const circumradius = inradius * sec(Math.PI / sides);
            //
            descriptor.points = [];
            //
            for (let s = 0; sides >= s; s++) {
                const angle = (2.0 * Math.PI * s) / sides;
                let x = circumradius * Math.cos(angle) + cx;
                let y = circumradius * Math.sin(angle) + cy;
                //
                if ( s == 0 ) {
                    region.moveTo(x,y);
                } else {
                    region.lineTo(x,y);
                }
                update_bounds(descriptor,x,y);
                descriptor.points.push([x,y]);
            }
            region.closePath();
            this._lines_and_fill(ctxt,pars,region);
            _path_path(descriptor);
            this._unscale();
        }

    }

     //
     star(pars) {
        if ( !pars ) return
        if ( this.ctxt ) {
            this._scale();
            let descriptor = this._descriptor("star",pars);
            let ctxt = this.ctxt;
            let [cx,cy,rad] = pars.points;
            let point = pars.star_points;
            const orient = pars.orient;
            const radialshift = pars.radial_shift;
            const radius_multiplier = pars.radius_multiplier;
            //
            const circumradius = rad / 1.5;
            const inradius = circumradius / radius_multiplier;

            ctxt.beginPath();
            let region = new Path2D();

            descriptor.points = [];

            for (let s = 0; point >= s; s++) {
                let angle = 2.0 * Math.PI * (s / point);
                if (orient === "point") {
                  angle -= Math.PI / 2;
                } else if (orient === "edge") {
                  angle = angle + Math.PI / point - Math.PI / 2;
                }
    
                let x = circumradius * Math.cos(angle) + cx;
                let y = circumradius * Math.sin(angle) + cy;

                if ( s == 0 ) {
                    region.moveTo(x,y);
                } else {
                    region.lineTo(x,y);
                }
                update_bounds(descriptor,x,y);
                descriptor.points.push([x,y]);

                if (!isNaN(inradius)) {
                  angle = 2.0 * Math.PI * (s / point) + Math.PI / point;
                  if (orient === "point") {
                    angle -= Math.PI / 2;
                  } else if (orient === "edge") {
                    angle = angle + Math.PI / point - Math.PI / 2;
                  }
                  angle += radialshift;
    
                  x = inradius * Math.cos(angle) + cx;
                  y = inradius * Math.sin(angle) + cy;
    
                  region.lineTo(x,y);
                  update_bounds(descriptor,x,y);
                  descriptor.points.push([x,y]);
                }
            }
            region.closePath();
            this._lines_and_fill(ctxt,pars,region);
            _path_path(descriptor);
            this._unscale();
        }
    }

     //
     redraw() {
        this.redrawing = true;
        let n = this.z_list.length;
        for ( let i = 0; i < n; i++ ) {
            let op = this.z_list[i];
            this._redraw_descriptor = op;
            let shape = op.shape;
            let self = this;
            self[shape](op.pars);
            this._redraw_descriptor = false;
        }
        this.redrawing = false;
    }


    //
    reverse_redraw() {
        this.reverse();
        this.redraw();
    }

    select_top(pars) {
        let top = this.z_top();
        if ( top >= 0 ) super.select(top);
    }

    select_bottom(pars) {
        let top = this.z_top();
        if ( top >= 0 ) super.select(0);
    }

    select(pars) {
        if ( !pars ) return
        let i = pars.select;
        super.select(i);
    }

    //
    send_bottom(pars) {
        if ( !pars ) return
        let i = pars.select;
        if ( i === false ) {
            i = this.selected;
        }
        super.select(i);
        this.selected_to_bottom();
        this.clear();
        this.redraw();
    }

    //
    send_top(pars) {
        if ( !pars ) return 
        let i = pars.select;
        if ( i === false ) {
            i = this.selected;
        }
        super.select(i);
        this.selected_to_top();
        this.clear();
        this.redraw();
    }

    update(pars) {
        let selected = this.selected_object();
        if ( selected ) {
            this.redrawing = true;
            selected.pars = pars;
            this.clear();
            this.redraw();
            this.redrawing = false;
        }
    }

    mouse_in_shape(pars) {
        if ( !pars ) return
        if ( this.ctxt ) {
            let ctxt = this.ctxt;
            let [x,y] = pars.mouse_loc;
            this.redrawing = true;
            let i = this.z_list.length;
            while ( (--i) >= 0 ) {
                let path = this.z_list[i].path;
                if ( path ) {
                    if ( ctxt.isPointInPath(path, x, y) ) {
                        return i
                    }
                }
            }
            this.redrawing = false;
        }
        return false
    }

    set_scale(pars) {
        if ( !pars ) return
        let [sx,sy] = pars.scale;
        this.scale_x = sx;
        this.scale_y = sy;
    }

    scale_redraw(pars) {
        this.set_scale(pars);
        this.clear();
        this.redraw();
    }
}

/* src/CanDraw.svelte generated by Svelte v3.44.1 */

function add_css(target) {
	append_styles(target, "svelte-sakez7", ".canvas-viz.svelte-sakez7{border:solid 1px black}");
}

function create_fragment(ctx) {
	let div;
	let canvas;
	let canvas_height_value;
	let canvas_width_value;

	return {
		c() {
			div = element("div");
			canvas = element("canvas");
			attr(canvas, "class", "canvas-viz svelte-sakez7");
			attr(canvas, "height", canvas_height_value = "" + (/*height*/ ctx[0] + "px"));
			attr(canvas, "width", canvas_width_value = "" + (/*width*/ ctx[1] + "px"));
		},
		m(target, anchor) {
			insert(target, div, anchor);
			append(div, canvas);
			/*canvas_binding*/ ctx[6](canvas);
		},
		p(ctx, [dirty]) {
			if (dirty & /*height*/ 1 && canvas_height_value !== (canvas_height_value = "" + (/*height*/ ctx[0] + "px"))) {
				attr(canvas, "height", canvas_height_value);
			}

			if (dirty & /*width*/ 2 && canvas_width_value !== (canvas_width_value = "" + (/*width*/ ctx[1] + "px"))) {
				attr(canvas, "width", canvas_width_value);
			}
		},
		i: noop,
		o: noop,
		d(detaching) {
			if (detaching) detach(div);
			/*canvas_binding*/ ctx[6](null);
		}
	};
}

function instance($$self, $$props, $$invalidate) {
	let { height = 460 } = $$props;
	let { width = 680 } = $$props;
	let { selected = false } = $$props;
	let { mouse_to_shape = false } = $$props;
	let the_canvas;
	let ctxt = false;
	let drawit = false;

	g_commander.subscribe(command => {
		if (!drawit) return;

		if (!ctxt && the_canvas) {
			$$invalidate(5, ctxt = the_canvas.getContext("2d"));
			drawit.setContext(ctxt);
		}

		//
		let pars = command.pars;

		if (command.shape !== undefined) {
			let shape = command.shape;
			drawit[shape](pars);
		} else if (command.command !== undefined) {
			let cmd = command.command;
			drawit[cmd](pars);
		} else if (command.update !== undefined) {
			drawit.update(pars);
		} else if (command.searching !== undefined) {
			$$invalidate(4, mouse_to_shape = drawit.mouse_in_shape(pars));
		}

		$$invalidate(3, selected = drawit.selected_object());
	});

	function canvas_binding($$value) {
		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
			the_canvas = $$value;
			$$invalidate(2, the_canvas);
		});
	}

	$$self.$$set = $$props => {
		if ('height' in $$props) $$invalidate(0, height = $$props.height);
		if ('width' in $$props) $$invalidate(1, width = $$props.width);
		if ('selected' in $$props) $$invalidate(3, selected = $$props.selected);
		if ('mouse_to_shape' in $$props) $$invalidate(4, mouse_to_shape = $$props.mouse_to_shape);
	};

	$$self.$$.update = () => {
		if ($$self.$$.dirty & /*the_canvas, ctxt, width, height*/ 39) {
			if (the_canvas) {
				$$invalidate(5, ctxt = the_canvas.getContext("2d"));
				drawit = new DrawTools(ctxt, width, height);
			}
		}
	};

	return [height, width, the_canvas, selected, mouse_to_shape, ctxt, canvas_binding];
}

class CanDraw extends SvelteComponent {
	constructor(options) {
		super();

		init(
			this,
			options,
			instance,
			create_fragment,
			safe_not_equal,
			{
				height: 0,
				width: 1,
				selected: 3,
				mouse_to_shape: 4
			},
			add_css
		);
	}
}

CanDraw.draw_model = draw_model;

export { CanDraw as default };
