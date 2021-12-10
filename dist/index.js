(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    (global = typeof globalThis !== 'undefined' ? globalThis : global || self, global.CanDraw = factory());
})(this, (function () { 'use strict';

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
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
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
    function set_style(node, key, value, important) {
        node.style.setProperty(key, value, important ? 'important' : '');
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function afterUpdate(fn) {
        get_current_component().$$.after_update.push(fn);
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


    const MIN_W_BOUNDING_BOX = 2;
    const MIN_H_BOUNDING_BOX = 2;


    const _rects_intersect = (rect1,rect2) => {
        let [x1,y1,w1,h1] = rect1;
        let [x2,y2,w2,h2] = rect2;

        let r1 = x1 + w1;
        let r2 = x2 + w2;
        let b1 = y1 + h1;
        let b2 = y2 + h2;

        if ( w1 <= 0 || h1 <= 0 || w2 <= 0 || h2 <= 0 ) { return false }    
        if ( r1 <= x2 || r2 <= x1  ) return false;
        if ( b1 <= y2 || b2 <= y1  ) return false;
        return true;
    };

    const max_box = (group_boxes) => {
        let min_x = 2000;
        let min_y = 2000;
        let max_x = 0;
        let max_y = 0;
        for ( let box of group_boxes ) {
            let [x,y,w,h] = box;
            if ( x < min_x ) min_x = x;
            if ( y < min_y ) min_y = y;
            x += w;
            y += h;
            if ( x > max_x ) max_x = x;
            if ( y > max_y ) max_y = y;
        }
        let w_hat = max_x - min_x;
        let h_hat = max_y - min_y;
        return [min_x,min_y,w_hat,h_hat]
    };

    const circle_bounding_rect = (centerX, centerY, radius) => {
        let left = centerX  - radius;
        let top = centerY - radius;
        let width = 2*radius;
        let height = 2*radius;
        return [left,top,width,height]
    };

    const ellipse_bounding_rect = (centerX, centerY, rad1, rad2,rotate) => {
        if ( rotate === 0.0 )  {
            let left = centerX  - rad1;
            let top = centerY - rad2;
            let width = 2*rad1;
            let height = 2*rad2;
            return [left,top,width,height]    
        } else {
            let cs = Math.cos(rotate);
            let sn = Math.sin(rotate);
            //
            let cs_sqr = cs*cs;
            let sn_sqr = sn*sn;
            let r1_sqr = rad1*rad1;
            let r2_sqr = rad2*rad2;
            //
            let lim_x = Math.sqrt(r1_sqr*cs_sqr + r2_sqr*sn_sqr);
            let lim_y = Math.sqrt(r1_sqr*sn_sqr + r2_sqr*cs_sqr);
            let bbox = [centerX - lim_x,centerY - lim_y,2*lim_x,2*lim_y];
            return bbox
        }
    };


    const text_box = (ctxt,txt) => {
        const textMetrics = ctxt.measureText(txt);
        let w = Math.abs(textMetrics.actualBoundingBoxLeft) +
                Math.abs(textMetrics.actualBoundingBoxRight);
        let top = textMetrics.actualBoundingBoxAscent;
        let h = top + Math.abs(textMetrics.actualBoundingBoxDescent);
        return [w,h,top]
    };


    const _rect_path = (descriptor,x1,y1,w,h) => {
        const rect_P = new Path2D();
        rect_P.rect(x1,y1,w,h);
        descriptor.path = rect_P;    
    };


    const x_of_pairs  = (points) => {
        let xs = points.map(pair => {
            return pair[0]
        });
        return xs
    };


    const y_of_pairs = (points) => {
        let ys = points.map(pair => {
            return pair[1]
        });
        return ys
    };



    const _translate_points = (vect,points) => {
        let x_trans = vect[0];
        let y_trans = vect[1];
        //
        for ( let p of points ) {
            p[0] += x_trans;
            p[1] += y_trans;
        }   
    };


    const _rotate_points = (rotate,points) => {
        let r00 = Math.cos(rotate);
        let r01 = -Math.sin(rotate);
        let r11 = r00;
        let r10 = -r01;
        //
        for ( let p of points ) {
            let x = p[0];
            let y = p[1];
            p[0] = r00*x + r01*y;
            p[1] = r10*x + r11*y;
        }
    };

    const _center_of_mass = (points) => {
        let n = points.length;
        let x_sum = 0.0;
        let y_sum = 0.0;
        for ( let p of points ) {
            x_sum += p[0];
            y_sum += p[1];
        }
        let c_o_m = [x_sum/n,y_sum/n]; 
        return(c_o_m)
    };

    const _neg_p = (point) => {
        point[0] = -point[0];
        point[1] = -point[1];
    };

    const _line_points = (x1,y1,x2,y2) => {
        let left = Math.min(x1,x2);
        let right = Math.max(x1,x2);
        let top = Math.min(y1,y2);
        let bottom = Math.max(y1,y2);
        return [left,top,right, bottom]
    };

    const _line_bounds = (x1,y1,x2,y2) => {
        let [left,top,right, bottom] = _line_points(x1,y1,x2,y2);
        let w = (right - left);
        let h = (bottom - top);
        if ( w < MIN_W_BOUNDING_BOX ) {
            w += MIN_W_BOUNDING_BOX;
            left -= MIN_W_BOUNDING_BOX;
        }
        if ( h < MIN_H_BOUNDING_BOX ) {
            h += MIN_H_BOUNDING_BOX;
            top -= MIN_H_BOUNDING_BOX;
        }
        return [left,top,(right - left),(bottom - top)]
    };

    const _rect_path_bounds = (descriptor,x1,y1,x2,y2,rotate) => {
        let r00 = Math.cos(rotate);
        let r01 = -Math.sin(rotate);
        let r11 = r00;
        let r10 = -r01;
        //
        let c_o_m_x = (x1 + x2)/2;
        let c_o_m_y = (y1 + y2)/2;
        //
        x1 -= c_o_m_x;
        y1 -= c_o_m_y;
        x2 -= c_o_m_x;
        y2 -= c_o_m_y;
        //  top-left
        let x11_r = (r00*x1 + r01*y1) + c_o_m_x;
        let y11_r = (r10*x1 + r11*y1) + c_o_m_y;
        //  bottom-right
        let x22_r = (r00*x2 + r01*y2) + c_o_m_x;
        let y22_r = (r10*x2 + r11*y2) + c_o_m_y;
        //
        // top-right x2,y1
        let x12_r = (r00*x2 + r01*y1) + c_o_m_x;
        let y12_r = (r10*x2 + r11*y1) + c_o_m_y;
        //  bottom-left x1,y2
        let x21_r = (r00*x1 + r01*y2) + c_o_m_x;
        let y21_r = (r10*x1 + r11*y2) + c_o_m_y;

        //
        const rect_lines_P = new Path2D();
        rect_lines_P.moveTo(x11_r,y11_r);
        rect_lines_P.lineTo(x12_r,y12_r);
        rect_lines_P.lineTo(x22_r,y22_r);
        rect_lines_P.lineTo(x21_r,y21_r);
        rect_lines_P.closePath();
        descriptor.path = rect_lines_P;

        let min_top = Math.min(y11_r,y22_r,y12_r,y21_r);
        let min_left = Math.min(x11_r,x22_r,x12_r,x21_r);
        let max_bottom = Math.max(y11_r,y22_r,y12_r,y21_r);
        let max_right = Math.max(x11_r,x22_r,x12_r,x21_r);

        descriptor.bounds = [min_top,min_left,max_right - min_top,max_bottom - min_top];
        descriptor.final_path = [[x11_r,y11_r],[x12_r,y12_r],[x22_r,y22_r],[x21_r,y21_r]];
    };

    const _line_path_bounds = (descriptor,points,rotate,store_rotation) => {
        let points_hat = [].concat(points);
        if ( (rotate !== undefined) && !isNaN(rotate) ) {
            let c_o_m = _center_of_mass(points_hat);
            _neg_p(c_o_m);
            _translate_points(c_o_m,points_hat);
            _rotate_points(rotate,points_hat);
            _neg_p(c_o_m);
            _translate_points(c_o_m,points_hat);
        }

        let xs = x_of_pairs(points_hat);
        let ys = y_of_pairs(points_hat);
        let min_left = Math.min(...xs);
        let min_top = Math.min(...ys);
        let max_right = Math.max(...xs);
        let max_bottom = Math.max(...ys);

        descriptor.bounds = [min_left,min_top,max_right - min_left,max_bottom - min_top];
        if ( store_rotation ) {
            descriptor.final_path = [].concat(points_hat);
        }

        let p0 = points_hat.shift();
        let x = p0[0];
        let y = p0[1];

        const lines_P = new Path2D();
        lines_P.moveTo(x,y);
        while ( points_hat.length ) {
            let p = points_hat.shift();
            let x = p[0];
            let y = p[1];
            lines_P.lineTo(x,y);
        }
        lines_P.closePath();
        descriptor.path = lines_P;

        return lines_P
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
        if ( ( Math.abs(x2 - x1) < 5 ) || ( Math.abs(y2 - y1) < 5 ) ) {
            let [px1,py1,px2,py2] = _line_points(x1,y1,x2,y2);
            line_P.moveTo(px1-5,py1-5);
            line_P.lineTo(px2+5,py1-5);
            line_P.lineTo(px2+5,py2+5);
            line_P.lineTo(px1-5,py2+5);
            line_P.lineTo(px1-5,py1-5);
            line_P.closePath();
        } else {
            let m = (y2 - y1)/(x2 - x1);   // slope
            // will take line to the endpoints of the segment, but could extend then using the normalized vector in the direction of the segment
            let e1_x = x1, e1_y = y1, e2_x = x2, e2_y = y2;  // enpoints after extension
            let p1_x = 0, p1_y = 0, p2_x = 0, p2_y = 0, p3_x = 0, p3_y = 0, p4_x = 0, p4_y = 0;
            let R = 5;  /// the distance points away from the line 
            let x, y;     // points on the circle intersecting the perpendicular to the zero centered segment
            //
            let b = (1.0 + 1.0/(m*m));
            x = Math.sqrt(R*(R/b));
            y = -(1/m)*x;
            let x_neg = -x;
            let y_neg = -y;
            //
            p1_x = x + e1_x;
            p1_y = y + e1_y;
            p2_x = x + e2_x;
            p2_y = y + e2_y;
            p3_x = x_neg + x2;
            p3_y = y_neg + y2;
            p4_x = x_neg + x1;
            p4_y = y_neg + y1;
            //
            line_P.moveTo(p1_x,p1_y);
            line_P.lineTo(p2_x,p2_y);
            line_P.lineTo(p3_x,p3_y);
            line_P.lineTo(p4_x,p4_y);
            line_P.lineTo(p1_x,p1_y);
            //
            line_P.closePath();
        }
        descriptor.path = line_P;
    };


    const _line_path_r = (descriptor,x1,y1,x2,y2,rotate) => {
        
        let points = false;
        if ( Math.abs(px2 - px1) < 3 ) {
            let [px1,py1,px2,py2] = _line_points(x1,y1,x2,y2);
            points = [[px1-5,py1-5],[px2+5,py1-5],[px2+5,py2+5],[px1,py2+5]];
        } else {
            points = [[x1,y1-5],[x2,y2-5],[x2,y2+5],[x1,y1+5]];
        }
        _line_path_bounds(descriptor,points,rotate,true);
    };


    const _text_path = (descriptor) => {
        let [x,y,w,h] = descriptor.bounds;
        _rect_path(descriptor,x,y,w,h);  // put a path on the descriptor
    };




    function _bezier_translate(trans,x1, y1, cp1_x, cp1_y, cp2_x, cp2_y, x2, y2) {
        let [delta_x,delta_y] = trans;

        return [x1 + delta_x, y1 + delta_y, cp1_x + delta_x, cp1_y + delta_y, cp2_x + delta_x, cp2_y + delta_y, x2 + delta_x, y2 + delta_y]
    }


    function _bezier_bounds(x1, y1, cp1_x, cp1_y, cp2_x, cp2_y, x2, y2) {
        let curve = new Path2D();
        let [x_u,y_u,cp1_tx,cp1_ty,cp2_tx,cp2_ty,end_x_u,end_y_u] = _bezier_translate([0,-5],x1, y1, cp1_x, cp1_y, cp2_x, cp2_y, x2, y2);
        curve.moveTo(x_u,y_u);
        curve.bezierCurveTo(cp1_tx,cp1_ty,cp2_tx,cp2_ty,end_x_u,end_y_u);
        //
        curve.lineTo(end_x_u,end_y_u + 10);
        //
        let [x_l,y_l,cp1_tx_l,cp1_ty_l,cp2_tx_l,cp2_ty_l,end_x_l,end_y_l] = _bezier_translate([0,+5],x1, y1, cp1_x, cp1_y, cp2_x, cp2_y, x2, y2);
        curve.moveTo(x_l,y_l);
        curve.bezierCurveTo(cp1_tx_l,cp1_ty_l,cp2_tx_l,cp2_ty_l,end_x_l,end_y_l);
        curve.moveTo(x_l,y_l);
        curve.lineTo(x_u,y_u);
        curve.closePath();
        return curve
    }


    function _bezier_rotate(rotate,x1,y1,cp1_x,cp1_y,cp2_x,cp2_y,x2, y2) {
        let c_o_m = _center_of_mass([[x1,y1],[x2, y2]]);
        let points_hat = [[x1,y1],[cp1_x,cp1_y],[cp2_x,cp2_y],[x2, y2]];
        _neg_p(c_o_m);
        _translate_points(c_o_m,points_hat);
        _rotate_points(rotate,points_hat);
        _neg_p(c_o_m);
        _translate_points(c_o_m,points_hat);
        let all_pars = [];
        all_pars.push(points_hat[0][0]);
        all_pars.push(points_hat[0][1]);
        all_pars.push(points_hat[1][0]);
        all_pars.push(points_hat[1][1]);
        all_pars.push(points_hat[2][0]);
        all_pars.push(points_hat[2][1]);
        all_pars.push(points_hat[3][0]);
        all_pars.push(points_hat[3][1]);
        return all_pars
    }

    function _bezier_bounds_rotate(x1, y1, cp1_x, cp1_y, cp2_x, cp2_y, x2, y2, rotate) {
        //
        if ( (rotate === undefined) && isNaN(rotate) ) {
            return _bezier_bounds(x1, y1, cp1_x, cp1_y, cp2_x, cp2_y, x2, y2)
        } else {
            let curve = new Path2D();
            let translated_1 = _bezier_translate([0,-5],x1, y1, cp1_x, cp1_y, cp2_x, cp2_y, x2, y2);
            let rotated_1 = _bezier_rotate(rotate,...translated_1);
            let sx_1 = rotated_1.shift();
            let sy_1 = rotated_1.shift();
            curve.moveTo(sx_1,sy_1);
            curve.bezierCurveTo(...rotated_1);
        
            let translated_2 = _bezier_translate([0,+5],x1, y1, cp1_x, cp1_y, cp2_x, cp2_y, x2, y2);
            let rotated_2 = _bezier_rotate(rotate,...translated_2);

            let endx_2 = rotated_2[6];
            let endy_2 = rotated_2[7];
            curve.lineTo(endx_2,endy_2);

            let sx_2 = rotated_2.shift();
            let sy_2 = rotated_2.shift();
            curve.moveTo(sx_2,sy_2);
            curve.bezierCurveTo(...rotated_2);
            //
            curve.moveTo(sx_2,sy_2);
            curve.lineTo(sx_1,sy_1);
            //
            return curve
        }
        //
    }



    function _quadratic_translate(trans,x1, y1, cp1_x, cp1_y, x2, y2) {
        let [delta_x,delta_y] = trans;
        return [x1 + delta_x, y1 + delta_y, cp1_x + delta_x, cp1_y + delta_y, x2 + delta_x, y2 + delta_y]
    }

    function _quadratic_bounds(x1, y1, cp1_x, cp1_y, x2, y2) {
        let curve = new Path2D();
        let [x_u,y_u,cp1_tx,cp1_ty,end_x_u,end_y_u] = _quadratic_translate([0,-5],x1, y1, cp1_x, cp1_y, x2, y2);
        curve.moveTo(x_u,y_u);
        curve.quadraticCurveTo(cp1_tx,cp1_ty,end_x_u,end_y_u);
        //
        curve.lineTo(end_x_u,end_y_u + 10);
        //
        let [x_l,y_l,cp1_tx_l,cp1_ty_l,end_x_l,end_y_l] = _quadratic_translate([0,+5],x1, y1, cp1_x, cp1_y, x2, y2);
        curve.moveTo(x_l,y_l);
        curve.quadraticCurveTo(cp1_tx_l,cp1_ty_l,end_x_l,end_y_l);
        curve.moveTo(x_l,y_l);
        curve.lineTo(x_u,y_u);
        curve.closePath();
        return curve
    }


    function _quadratic_rotate(rotate,x1,y1,cp1_x,cp1_y,x2, y2) {
        let c_o_m = _center_of_mass([[x1,y1],[x2, y2]]);
        let points_hat = [[x1,y1],[cp1_x,cp1_y],[x2, y2]];
        _neg_p(c_o_m);
        _translate_points(c_o_m,points_hat);
        _rotate_points(rotate,points_hat);
        _neg_p(c_o_m);
        _translate_points(c_o_m,points_hat);
        let all_pars = [];
        all_pars.push(points_hat[0][0]);
        all_pars.push(points_hat[0][1]);
        all_pars.push(points_hat[1][0]);
        all_pars.push(points_hat[1][1]);
        all_pars.push(points_hat[2][0]);
        all_pars.push(points_hat[2][1]);
        return all_pars
    }

    function _quadratic_bounds_rotate(x1, y1, cp1_x, cp1_y, x2, y2, rotate) {
        //
        if ( (rotate === undefined) && isNaN(rotate) ) {
            return _quadratic_bounds(x1, y1, cp1_x, cp1_y, x2, y2)
        } else {
            let curve = new Path2D();
            let translated_1 = _quadratic_translate([0,-5],x1, y1, cp1_x, cp1_y, x2, y2);
            let rotated_1 = _quadratic_rotate(rotate,...translated_1);
            let sx_1 = rotated_1.shift();
            let sy_1 = rotated_1.shift();
            curve.moveTo(sx_1,sy_1);
            curve.quadraticCurveTo(...rotated_1);
        
            let translated_2 = _quadratic_translate([0,+5],x1, y1, cp1_x, cp1_y, x2, y2);
            let rotated_2 = _quadratic_rotate(rotate,...translated_2);

            let endx_2 = rotated_2[4];
            let endy_2 = rotated_2[5];
            curve.lineTo(endx_2,endy_2);

            let sx_2 = rotated_2.shift();
            let sy_2 = rotated_2.shift();
            curve.moveTo(sx_2,sy_2);
            curve.quadraticCurveTo(...rotated_2);
            //
            curve.moveTo(sx_2,sy_2);
            curve.lineTo(sx_1,sy_1);
            //
            return curve
        }
        //
    }



    function draw_tick_delta(ctx,width,height,x_tick_delta,y_tick_delta) {
        //
        let cur_x = 0;
        let cur_y = 0;
        while ( cur_x < width ) {
            ctx.moveTo(cur_x,0);
            ctx.lineTo(cur_x,height);
            cur_x += x_tick_delta;
        }

        while ( cur_y < height ) {
            ctx.moveTo(0,cur_y);
            ctx.lineTo(width,cur_y);
            cur_y += y_tick_delta;
        }
        //
    }


    function grid_on_canvas(ctx,width,height,x_mag,y_mag,ruler_interval) {

        let x_interval = ruler_interval;
        if ( x_mag < 1 ) {
            x_interval = Math.floor(100*(1/x_mag));
        }
        let x_tick_delta = x_mag*Math.floor(x_interval/10);

        let y_interval = ruler_interval;
        if ( y_mag < 1 ) {
            y_interval = Math.floor(100*(1/y_mag));
        }
        let y_tick_delta = y_mag*Math.floor(y_interval/10);


        ctx.lineWidth = 1;
        ctx.fillStyle = '#000';
        ctx.strokeStyle = '#000000';
        ctx.setLineDash([]);
        ctx.beginPath();
        draw_tick_delta(ctx,width,height,20*x_tick_delta,20*y_tick_delta);
        ctx.stroke();
        ctx.closePath();

        ctx.strokeStyle = '#CFCFCF';
        ctx.beginPath();
        draw_tick_delta(ctx,width,height,2*x_tick_delta,2*y_tick_delta);
        ctx.stroke();
        ctx.closePath();

    }


    const test_draw_path = (ctxt,descriptor) => {
        let path = descriptor.path;
        if ( path ) {
            ctxt.save();
            ctxt.lineWidth = 2;
            ctxt.strokeStyle = 'magenta';
            ctxt.setLineDash([1,1,2,1]);
            ctxt.stroke(path);
            ctxt.restore();
        }
    };


    class ZList {

        // 
        constructor() {
            this.z_list = [];
            this.redrawing = false;
            this.selected = -1;
            this._selected_object = false;
            this._redraw_descriptor = false;
        }

        select(ith) {
            if ( (ith >= 0) && (ith < this.z_list.length) ) {
                this.selected = ith;
            }
        }

        deselect() {
            this.selected = -1;
        }

        selected_object() {
            if ( (this.selected >= 0) && (this.selected < this.z_list.length) ) {
                this._selected_object = this.z_list[this.selected];
                return this._selected_object
            }
            return false
        }

        ith_object(ith) {
            if ( (ith >= 0) && (ith < this.z_list.length) ) {
                return(this.z_list[ith])
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
            if ( (this.selected >= 0) && (this.selected < this.z_list.length )) {
                this.z_list.pop();
            }
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

        z_top_object() {
            let n = (this.z_list.length - 1);
            if ( n >= 0 ) {
                return this.z_list[n]
            }
            return false
        }

        z_list_deep_clone() {
            let zclone = JSON.parse(JSON.stringify(this.z_list));
            return zclone
        }

        z_list_replace(z_replacement) {
            this.z_list = z_replacement;
            this.selected = -1;
        }

        // ---- ---- ---- ---- ---- ---- ---- ---- ---- ----

        get_by_id_and_role(id,role) {
            for ( let obj of this.z_list ) {
                if ( (obj.id === id) && (obj.role === role) ) {
                    return obj
                }
            }
            return false
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
            //
            this._with_grid = false;
            this.ruler_interval = 50;
            //
            this.grad_list = {};

            this.lineCap = false;
            this.lineDashOffset = false;
            this.lineJoin = false;
            this.lineWidth = false;
            this.miterLimit = false;
            this.shadowBlur = false;
            this.shadowColor = false;
            this.shadowOffsetX = false;
            this.shadowOffsetY = false;
        }

        setContext(ctxt) {
            this.ctxt = ctxt;
        }

        clear() {
            if ( this.ctxt ) {
                if ( ( this.scale_x < 1.0 ) || ( this.scale_y < 1.0 ) ) {
                    this.ctxt.clearRect(0,0,(this.width/this.scale_x),(this.height/this.scale_y));
                } else {
                    if ( this.scale_y > 1.0 ) this._scale();
                    this.ctxt.clearRect(0,0,this.width,this.height);
                    if ( this.scale_y > 1.0 )this._unscale();    
                }
            }
        }

        clear_all() {
            this.clear_z();
            this.clear();
        }


        canvas_size(w,h) {
            this.width = w;
            this.height = h;
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


        _translate(t_x,t_y) {
            let ctxt = this.ctxt;
            if ( ctxt ) {
                ctxt.translate(t_x,t_y);
            }
        }

        _translate(t_x,t_y) {
            let ctxt = this.ctxt;
            if ( ctxt ) {
                ctxt.translate(t_x,t_y);
            }
        }


        rotate(t_x,t_y,theta) {
            let ctxt = this.ctxt;
            if ( ctxt ) {
                ctxt.save();
                this._translate(t_x,t_y);
                ctxt.rotate(theta);
            }
        }

        unrotate(t_x,t_y,theta) {
            let ctxt = this.ctxt;
            if ( ctxt ) {
                ctxt.restore();
                //ctxt.rotate(-theta)
                //this._translate(-t_x,-t_y)
            }
        }

        _resets() {
            this.gradient = false;
            this.lineCap = false;
            this.lineDashOffset = false;
            this.lineJoin = false;
            this.lineWidth = false;
            this.miterLimit = false;
            this.shadowBlur = false;
            this.shadowColor = false;
            this.shadowOffsetX = false;
            this.shadowOffsetY = false;
        }

        //
        _lines_and_fill(ctxt,pars,path) {
            if ( pars.fill !== "none" ) {
                ctxt.fillStyle = this.gradient ? this.gradient : pars.fill;
                if ( path ) ctxt.fill(path,"evenodd");
                else ctxt.fill();
            }
            if ( pars.line !== "none" ) {
                ctxt.lineWidth = pars.thick;
                ctxt.strokeStyle = pars.line;
                if ( pars.line_dash && Array.isArray(pars.line_dash) ) {
                    ctxt.setLineDash(pars.line_dash);
                } else {
                    ctxt.setLineDash([]);
                }
                if ( path ) ctxt.stroke(path);
                else ctxt.stroke();
            }
        }
        
        
        _descriptor(shape,pars) {
            if ( this._redraw_descriptor ) return this._redraw_descriptor
            else {
                let descriptor = { "shape" : shape, "pars" : pars, "bounds" : [] };
                //
                if ( pars.role ) {      // a lifted parameter -- may generalize to others.
                    descriptor.role = pars.role;
                }
                if ( pars.id ) {      // a lifted parameter -- may generalize to others.
                    descriptor.id = pars.id;
                }
                
                this.push(descriptor);
                return descriptor    
            }
        }

        text_rect(text,x,y,pars,descriptor) {
            let ctxt = this.ctxt;
            if ( ctxt ) {
                let [w,h,top] = text_box(ctxt,text);
                switch ( pars.textAlign ) {
                    //case "left":
                    //case "start": {
                    //    break
                    //}
                    case "center": {
                        x -= w/2;
                        break
                    }
                    case "right":
                    case "end": {
                        x -= w;
                        break
                    }
                }
                return [x,y-top,w,h]
            }
            return descriptor.bounds
        }


        add_gradient(pars) {
            if ( !pars ) return
            if ( this.ctxt ) {
                let ctxt = this.ctxt;
                let grad_name = pars.name;
                let grad_type = pars.type;
                let stops = pars.stops;
                switch ( grad_type ) {
                    case "conic" : {
                        let [cx,cy,angle] = pars.points;
                        let gradient = ctxt.createConicGradient(cx,cy,angle);

                        for ( let stop of stops ) {
                            gradient.addColorStop(stop.x, stop.color);
                        }

                        this.grad_list[grad_name] = gradient;
                        break;
                    }
                    case "radial" : {
                        let [x0,y0,r0,x1,y1,r1] = pars.points;
                        let gradient = ctxt.createRadialGradient(x0,y0,r0,x1,y1,r1);

                        for ( let stop of stops ) {
                            gradient.addColorStop(stop.x, stop.color);
                        }

                        this.grad_list[grad_name] = gradient;
                        break;
                    }
                    case "linear" : {
                        let [x0,y0,x1,y1] = pars.points;
                        let gradient = ctxt.createLinearGradient(x0,y0,x1,y1);

                        for ( let stop of stops ) {
                            gradient.addColorStop(stop.x, stop.color);
                        }

                        this.grad_list[grad_name] = gradient;
                        break;
                    }
                }
            }
        }


        use_gradient(pars) {
            if ( !pars ) return
            let grad_name = pars.name;
            this.gradient = this.grad_list[grad_name];
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
                if ( (pars.rotate !== undefined) && ( pars.rotate !== false) && (pars.rotate !== 0.0)  ) {
                    let c_x = (x1 + w/2);
                    let c_y = (y1 + h/2);
                    _rect_path_bounds(descriptor,x1,y1,(x1 + w),(y1 + h),pars.rotate);
                    this.rotate(c_x,c_y,pars.rotate);
                    if ( pars.line && (pars.line !== "none") ) {
                        ctxt.lineWidth = pars.thick;
                        ctxt.strokeStyle = pars.line;
                        if ( pars.line_dash && Array.isArray(pars.line_dash) ) {
                            ctxt.setLineDash(pars.line_dash);
                        } else {
                            ctxt.setLineDash([]);
                        }
                        ctxt.strokeRect((x1 - c_x),(y1 - c_y),w,h);
                    }
                    if ( pars.fill && (pars.fill !== "none") ) {
                        ctxt.fillStyle = this.gradient ? this.gradient : pars.fill;
                        ctxt.fillRect((x1 - c_x),(y1 - c_y),w,h);
                    }
                    this.unrotate(c_x,c_y,pars.rotate);
                } else {
                    _rect_path(descriptor,x1,y1,w,h);
                    if ( pars.line && (pars.line !== "none") ) {
                        ctxt.lineWidth = pars.thick;
                        ctxt.strokeStyle = pars.line;
                        if ( pars.line_dash && Array.isArray(pars.line_dash) ) {
                            ctxt.setLineDash(pars.line_dash);
                        } else {
                            ctxt.setLineDash([]);
                        }
                        ctxt.strokeRect(x1,y1,w,h);
                    }
                    if ( pars.fill && (pars.fill !== "none") ) {
                        ctxt.fillStyle = this.gradient ? this.gradient : pars.fill;
                        ctxt.fillRect(x1,y1,w,h);
                    }
                    descriptor.bounds = [x1,y1,w,h];
                }
                //
    // test_draw_path(ctxt,descriptor)
                //
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
                //
                if ( pars.line !== "none" ) {
                    this._scale();
                    if ( (pars.rotate !== undefined) && ( pars.rotate !== false) && (pars.rotate !== 0.0)  ) {
                        let c_x = (x1 + x2)/2;
                        let c_y = (y1 + y2)/2;
                        this.rotate(c_x,c_y,pars.rotate);
                        ctxt.beginPath();
                        ctxt.lineWidth = pars.thick;
                        ctxt.strokeStyle = pars.line;
                        if ( pars.line_dash && Array.isArray(pars.line_dash) ) {
                            ctxt.setLineDash(pars.line_dash);
                        } else {
                            ctxt.setLineDash([]);
                        }
                        ctxt.moveTo((x1-c_x),(y1-c_y));
                        ctxt.lineTo((x2-c_x),(y2-c_y));
                        ctxt.stroke();
                        this.unrotate(c_x,c_y,pars.rotate);
                        descriptor.bounds = _line_bounds(x1,y1,x2,y2);
                        _line_path_r(descriptor,x1,y1,x2,y2,pars.rotate);  // path only
                    } else {
                        descriptor.bounds = _line_bounds(x1,y1,x2,y2);
                        _line_path(descriptor,x1,y1,x2,y2);      // path_only
                        ctxt.beginPath();
                        ctxt.lineWidth = pars.thick;
                        ctxt.strokeStyle = pars.line;
                        if ( pars.line_dash && Array.isArray(pars.line_dash) ) {
                            ctxt.setLineDash(pars.line_dash);
                        } else {
                            ctxt.setLineDash([]);
                        }
                        ctxt.moveTo(x1,y1);
                        ctxt.lineTo(x2,y2);
                        ctxt.stroke();
                    }
    //
    // test_draw_path(ctxt,descriptor)
    //
                    this._unscale();
                }
            }
        }


        // Cubic Bézier curve
        bezier(pars) {
            if ( !pars ) return
            if ( this.ctxt ) {
                this._scale();

                let descriptor = this._descriptor("bezier",pars);
                let ctxt = this.ctxt;
                let [x1,y1,x2,y2] = pars.points;
                let [cp1_x,cp1_y,cp2_x,cp2_y] = pars.control_points;
                //
                ctxt.lineWidth = pars.thick;
                ctxt.strokeStyle = pars.line;
                if ( pars.line_dash && Array.isArray(pars.line_dash) ) {
                    ctxt.setLineDash(pars.line_dash);
                } else {
                    ctxt.setLineDash([]);
                }
                //
                let curve = new Path2D();
                if ( (pars.rotate !== undefined) && ( pars.rotate !== false) && (pars.rotate !== 0.0)  ) {
                    let c_x = (x1 + x2)/2;
                    let c_y = (y1 + y2)/2;
                    curve.moveTo(x1 - c_x,y1 - c_y);
                    curve.bezierCurveTo(cp1_x - c_x, cp1_y - c_y, cp2_x - c_x, cp2_y - c_y, x2 - c_x, y2 - c_y);
                    //
                    this.rotate(c_x,c_y,pars.rotate);
                    ctxt.beginPath();
                    ctxt.stroke(curve);
                    this.unrotate(c_x,c_y,pars.rotate);
                    descriptor.path = _bezier_bounds_rotate(x1, y1, cp1_x, cp1_y, cp2_x, cp2_y, x2, y2, pars.rotate);
                    _line_path_r(descriptor,x1,y1,x2,y2,pars.rotate);
                } else {
                    curve.moveTo(x1,y1);
                    curve.bezierCurveTo(cp1_x, cp1_y, cp2_x, cp2_y, x2, y2);
                    ctxt.beginPath();
                    ctxt.stroke(curve);
                    descriptor.path = _bezier_bounds(x1,y1,cp1_x, cp1_y, cp2_x, cp2_y, x2, y2);
                    _line_path(descriptor,x1,y1,x2,y2);
                }
    // test_draw_path(ctxt,descriptor)
                this._unscale();
                //
            }
        }


        // Quadratic Bézier curve
        quadratic(pars) {
            if ( !pars ) return
            if ( this.ctxt ) {
                this._scale();

                let descriptor = this._descriptor("quadratic",pars);
                let ctxt = this.ctxt;
                let [x1,y1,x2,y2] = pars.points;
                let [cp1_x,cp1_y] = pars.control_points;
                //
                ctxt.lineWidth = pars.thick;
                ctxt.strokeStyle = pars.line;
                if ( pars.line_dash && Array.isArray(pars.line_dash) ) {
                    ctxt.setLineDash(pars.line_dash);
                } else {
                    ctxt.setLineDash([]);
                }
                //
                let curve = new Path2D();
                if ( (pars.rotate !== undefined) && ( pars.rotate !== false) && (pars.rotate !== 0.0)  ) {
                    let c_x = (x1 + x2)/2;
                    let c_y = (y1 + y2)/2;
                    curve.moveTo(x1 - c_x,y1 - c_y);
                    curve.quadraticCurveTo(cp1_x - c_x, cp1_y - c_y, x2 - c_x, y2 - c_y);
                    //
                    this.rotate(c_x,c_y,pars.rotate);
                    ctxt.beginPath();
                    ctxt.stroke(curve);
                    this.unrotate(c_x,c_y,pars.rotate);
                    //
                    descriptor.path = _quadratic_bounds_rotate(x1, y1, cp1_x, cp1_y, x2, y2, pars.rotate);
                    _line_path_r(descriptor,x1,y1,x2,y2,pars.rotate);
                    //
                } else {
                    curve.moveTo(x1,y1);
                    curve.quadraticCurveTo(cp1_x, cp1_y, x2, y2);
                    ctxt.beginPath();
                    ctxt.stroke(curve);
                    descriptor.path = _quadratic_bounds(x1, y1, cp1_x, cp1_y, x2, y2);
                    _line_path(descriptor,x1,y1,x2,y2);
                }
                //
    // test_draw_path(ctxt,descriptor)
                //
                this._unscale();
                //
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
                ctxt.lineWidth = pars.thick;
                ctxt.strokeStyle = pars.line;
                if ( pars.line_dash && Array.isArray(pars.line_dash) ) {
                    ctxt.setLineDash(pars.line_dash);
                } else {
                    ctxt.setLineDash([]);
                }
                ctxt.font = pars.font;
                ctxt.textAlign = pars.textAlign;
                ctxt.textBaseline = pars.textBaseline;
                //
                if ( (pars.rotate !== undefined) && ( pars.rotate !== false) && (pars.rotate !== 0.0)  ) {
                    descriptor.bounds = this.text_rect(text,x,y,pars,descriptor);
                    let [x1,y1,w,h] = descriptor.bounds;  // get it up front to get a center
                    let c_x = x1 + w/2;
                    let c_y = y1 + h/2;
                    this.rotate(c_x,c_y,pars.rotate);
                    ctxt.beginPath();
                    //
                    if ( pars.line && (pars.line !== "none") ) {
                        ctxt.strokeText(text, x-c_x, y-c_y);
                    }
                    if ( pars.fill && (pars.fill !== "none") ) {
                        ctxt.fillStyle = this.gradient ? this.gradient : pars.fill;
                        ctxt.fillText(text, x-c_x, y-c_y);
                    }
                    this.unrotate(c_x,c_y,pars.rotate);
                    _rect_path_bounds(descriptor,x1,y1,x1 + w,y1 + h,pars.rotate);
                } else {
                    ctxt.beginPath();
                    descriptor.bounds = this.text_rect(text,x,y,pars,descriptor);
                    //let [x1,y1,w,h] = descriptor.bounds
                    //
                    if ( pars.line && (pars.line !== "none") ) {
                        ctxt.strokeText(text, x, y);
                        //  ctxt.strokeRect(x1, y1, w, h)  for testing...
                    }
                    if ( pars.fill && (pars.fill !== "none") ) {
                        ctxt.fillStyle = this.gradient ? this.gradient : pars.fill;
                        ctxt.fillText(text, x, y);
                    }
                    _text_path(descriptor);  // put a path on the descriptor for selection
                }
                //
    // test_draw_path(ctxt,descriptor)
                //
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

    // test_draw_path(ctxt,descriptor)

                this._unscale();
                this._resets();
            }
        }


        //
        ellipse(pars) {
            if ( !pars ) return
            if ( this.ctxt ) {
                this._scale();
                let descriptor = this._descriptor("ellipse",pars);
                let ctxt = this.ctxt;
                let [centerX, centerY, rad1, rad2] = pars.points;
                let rotate = ((pars.rotate !== undefined) && pars.rotate && (pars.rotate !== 0.0) ) ? pars.rotate : 0.0;
                if ( rad1 <= 0 ) { this._unscale(); return }
                if ( rad2 <= 0 ) { this._unscale(); return }
                _ellipse_path(descriptor,centerX,centerY,rad1,rad2,rotate);
                ctxt.beginPath();
                ctxt.ellipse(centerX, centerY, rad1, rad2, rotate, 0, 2 * Math.PI);
                this._lines_and_fill(ctxt,pars);
                descriptor.bounds = ellipse_bounding_rect(centerX, centerY, rad1, rad2,rotate);
                //
    // test_draw_path(ctxt,descriptor)
                //
                this._unscale();
            }
        }


        //  path
        path(pars) {
            if ( !pars ) return
            if ( this.ctxt ) {
                this._scale();
                let descriptor = this._descriptor("path",pars);
                let ctxt = this.ctxt;
                let points = pars.points;
                descriptor.points = points;

                let rotate = pars.rotate;
                if ( (rotate !== undefined) && !isNaN(rotate) ) {
                    let c_o_m = _center_of_mass(points);
                    _neg_p(c_o_m);
                    _translate_points(c_o_m,points);
                    _rotate_points(rotate,points);
                    _neg_p(c_o_m);
                    _translate_points(c_o_m,points);
                }

                region = _line_path_bounds(descriptor,descriptor.points,false,true);

                this._lines_and_fill(ctxt,pars,region);
                descriptor.path = region;
                this._unscale();
            }
        }


        //  polygon
        polygon(pars) {
            if ( !pars ) return
            if ( this.ctxt ) {
                this._scale();
                let descriptor = this._descriptor("polygon",pars);
                let ctxt = this.ctxt;
                let [cx,cy,rad] = pars.points;
                let sides = pars.sides;

                descriptor.points = [];
                //
                const edg = (rad / 1.5);
                const inradius = (edg / 2) * cot(Math.PI / sides);
                const circumradius = inradius * sec(Math.PI / sides);
                //
                for (let s = 0; sides >= s; s++) {
                    const angle = (2.0 * Math.PI * s) / sides;
                    let x = circumradius * Math.cos(angle) + cx;
                    let y = circumradius * Math.sin(angle) + cy;
                    //
                    //update_bounds(descriptor,x,y)
                    descriptor.points.push([x,y]);
                }

                let region = false;
                if ( (pars.rotate !== undefined) && ( pars.rotate !== false) && (pars.rotate !== 0.0)  ) {
                    region = _line_path_bounds(descriptor,descriptor.points,pars.rotate,true);
                } else {
                    region = _line_path_bounds(descriptor,descriptor.points,false,true);
                }

                ctxt.beginPath();
                this._lines_and_fill(ctxt,pars,region);
                descriptor.path = region;
    // test_draw_path(ctxt,descriptor)
                this._unscale();
            }

        }


        change_star_radius(descriptor,ctrl_point,dx,dy,no_r_change) {
            if ( descriptor === undefined || !(descriptor) ) return
            let points = descriptor.pars.points;
            //let final_path = descriptor.final_path
            let cx = points[0];
            let cy = points[1];
            //
            //let sample_point = final_path[0]
            let outer_x = ctrl_point.x;
            let outer_y = ctrl_point.y;
            //
            let t_x = (outer_x - cx);
            let t_y = (outer_y - cy);//
            //
            let R = Math.sqrt(t_x*t_x + t_y*t_y);
            if ( !no_r_change ) {
                points[2] = R*1.5;
            }
            return points
        }


        //  star
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
            
                        descriptor.points.push([x,y]);
                    }
                }
                region.closePath();

                if ( (pars.rotate !== undefined) && ( pars.rotate !== false) && (pars.rotate !== 0.0)  ) {
                    region = _line_path_bounds(descriptor,descriptor.points,pars.rotate,true);
                } else {
                    region = _line_path_bounds(descriptor,descriptor.points,false,true);
                }

                this._lines_and_fill(ctxt,pars,region);
                descriptor.path = region;
    // test_draw_path(ctxt,descriptor)
                this._unscale();
            }
        }


        //
        bounding_path(pars) {
            if ( !pars ) return
            if ( this.ctxt ) {
                this.clear();
                this.redraw();
                //
                this.clear();
                this.redraw();
                //
                let i = pars.index;
                let state = pars.state;
                if ( state ) {
                    let descriptor = this.z_list[i];
                    let ctxt = this.ctxt;
                    this._scale();
                    test_draw_path(ctxt,descriptor);
                    this._unscale();
                }
                //
            }
        }

        //
        redraw() {
            this.redrawing = true;
            this._draw_grid();
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
            this.clear();
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

        deselect(pars) {
            if ( !pars ) return
            super.deselect();
        }

        //
        send_bottom(pars) {
            if ( !pars ) return
            if ( Array.isArray(pars.select) ) {
                let selects = [].concat(pars.select);
                selects.sort();
                selects.reverse();
                let descriptors = selects.map(ith => { return this.z_list[ith]} );
                for ( let i = 0; i < selects.length; i++ ) {
                    let ith = selects[i];
                    this.z_list.splice(ith,1);
                }
                for ( let descriptor of descriptors ) {
                    this.z_list.unshift(descriptor);  // push onto the front
                }
                this.select_top();
           } else {
                let i = pars.select;
                if ( i === false ) {
                    i = this.selected;
                }
                super.select(i);
                this.selected_to_bottom();    
            }
            this.clear();
            this.redraw();
        }

        //
        send_top(pars) {
            if ( !pars ) return 
            if ( Array.isArray(pars.select) ) {
                let selects = pars.select;
                selects.sort();
                let descriptors = selects.map(ith => { return this.z_list[ith]} );
                selects.reverse();
                for ( let i = 0; i < selects.length; i++ ) {
                    let ith = selects[i];
                    this.z_list.splice(ith,1);
                }
                for ( let descriptor of descriptors ) {
                    this.z_list.push(descriptor);
                }
                this.select_top();
            } else {
                let i = pars.select;
                if ( i === false ) {
                    i = this.selected;
                }
                super.select(i);
                this.selected_to_top();
            }
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


        update_by_id(pars) {
            let id = pars.id;
            let role = pars.role;
            if ( id && role ) {
                this.redrawing = true;
                let selected = this.get_by_id_and_role(id,role);
                if ( selected ) {
                    selected.pars = pars;
                }
                this.redrawing = false;
            }
        }


        refresh(pars) {
            this.redrawing = true;
            this.clear();
            this.redraw();
            this.redrawing = false;
        }


        mouse_in_shape(pars) {
            if ( !pars ) return
            if ( this.ctxt ) {
                let exclusion = pars.exclude ? pars.exclude : false;
                let ctxt = this.ctxt;
                let [x,y] = pars.mouse_loc;
                this.redrawing = true;
                let i = this.z_list.length;
                while ( (--i) >= 0 ) {
                    if ( exclusion === i ) continue
                    let path = this.z_list[i].path;
                    if ( path ) {
                        if ( ctxt.isPointInPath(path, x, y) ) {
                            this.redrawing = false;
                            return i
                        }
                    }
                }
                this.redrawing = false;
            }
            return false
        }

        //
        mouse_in_shapes_all(mouse_loc) {
            if ( this.ctxt ) {
                let ctxt = this.ctxt;
                let [x,y] = mouse_loc;
                let i = this.z_list.length;
                let shape_finds = [];
                while ( (--i) >= 0 ) {
                    let path = this.z_list[i].path;
                    if ( path ) {
                        if ( ctxt.isPointInPath(path, x, y) ) {
                            this.redrawing = false;
                            shape_finds.push(i);
                        }
                    }
                }
                return shape_finds
            }
            return false
        }

        //
        bounds_intersect(pars) {
            if ( !pars ) return
            let test_rect = pars.rect;
            this.redrawing = true;
            let i = this.z_list.length;
            while ( (--i) >= 0 ) {
                let descriptor = this.z_list[i];
                if ( descriptor ) {
                    if ( _rects_intersect(test_rect,descriptor.bounds) ) {
                        this.redrawing = false;
                        return i
                    }
                }
            }
            this.redrawing = false;
        }


        _all_bounds_intersect(test_rect) {
            let i = this.z_list.length;
            let sel_list = [];
            while ( (--i) >= 0 ) {
                let descriptor = this.z_list[i];
                if ( descriptor ) {
                    if ( _rects_intersect(test_rect,descriptor.bounds) ) {
                        sel_list.push(i);
                    }
                }
            }
            return sel_list
        }

        all_bounds_intersect(pars) {
            if ( !pars ) return
            let test_rect = pars.rect;
            this.redrawing = true;
            let sel_list = this._all_bounds_intersect(test_rect);
            this.redrawing = false;
            return sel_list
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



        is_group_selection() {
            let descriptor = this.z_top_object();
            if ( descriptor.shape === 'group' ) {
                let children = descriptor.children;
                if ( !children ) {
                    if ( (descriptor.select_list !== undefined) && Array.isArray(descriptor.select_list) ) {
                        //
                        return (descriptor.select_list.length > 0) 
                        //
                    }
                }
            }
        }

        // 
        remove_selected() {
            if ( this.is_group_selection() ) {
                let descriptor = this.z_top_object();
                let del_list = descriptor.select_list;
                del_list.sort();
                del_list.reverse();
                let exclusions = descriptor.exclusion_list;
                if ( exclusions === undefined ) {
                    exclusions = [];
                    descriptor.exclusion_list = exclusions;
                }
        
                for ( let ith of del_list ) {
                    if ( exclusions.indexOf(ith) < 0 ) {
                        super.select(ith);
                        this.selected_to_top();
                        this.pop();
                    }
                }
                this.clear();
                this.redraw();
            } else {
                this.selected_to_top();
                this.pop();
                this.clear();
                this.redraw();    
            }
        }

        z_list_replace(pars) {
            if ( !pars ) return
            let z_replacement = pars.z_list;
            super.z_list_replace(z_replacement);
            this.clear();
            this.redraw();
        }


        set_grid(pars) {
            if ( pars ) {
                this.ruler_interval = pars.interval;
                let was_on = this._with_grid;
                this._with_grid = pars.grid_on;
                if ( was_on !== this._with_grid ) {
                    this.clear();
                    this.redraw();        
                }
            }
        }


        _draw_grid() {
            let ctxt = this.ctxt;
            if ( ctxt && this._with_grid ) {
                let ruler_interval = this.ruler_interval;
                grid_on_canvas(ctxt,this.width,this.height,this.scale_x,this.scale_y,ruler_interval);
            }
        }




        group(pars) {
            if ( !pars ) return
            if ( this.ctxt ) {
                this._scale();
                let descriptor = this._descriptor("group",pars);
                let ctxt = this.ctxt;
                let [x1,y1,w,h] = pars.points;
                _rect_path(descriptor,x1,y1,w,h);
                if ( pars.line && (pars.line !== "none") ) {
                    ctxt.save();
                    ctxt.lineWidth = pars.thick;
                    ctxt.strokeStyle = pars.line;
                    ctxt.setLineDash([5, 3]);
                    ctxt.strokeRect(x1,y1,w,h);
                    ctxt.restore();
                }
                if ( pars.fill && (pars.fill !== "none") ) {
                    ctxt.fillStyle = this.gradient ? this.gradient : pars.fill;
                    ctxt.fillRect(x1,y1,w,h);
                }
                descriptor.bounds = [x1,y1,w,h];

                ctxt.save();
                ctxt.lineWidth = 1;
                ctxt.strokeStyle ='rgba(200,127,127,0.9)';
                ctxt.font = "12px cursive";
                ctxt.textAlign = "center";
                ctxt.textBaseline = "middle";
                ctxt.strokeText('G', x1, y1);
                ctxt.restore();

                if ( descriptor.do_drawing_state ) {
                    let sel_list = this._all_bounds_intersect(descriptor.bounds);
                    descriptor.select_list = sel_list;
                    descriptor.do_draw_selections = true;
                }

                let all_i = descriptor.select_list;
                let state = descriptor.do_draw_selections;
                let exclusions = descriptor.exclusion_list;
                if ( exclusions === undefined ) {
                    exclusions = [];
                    descriptor.exclusion_list = exclusions;
                }

                if ( state ) {
                    let ctxt = this.ctxt;
                    for ( let i of all_i ) {
                        if ( i !== this.selected ) {
                            if ( exclusions.indexOf(i) < 0 ) {
                                let child_descriptor = this.z_list[i];
                                test_draw_path(ctxt,child_descriptor);    
                            }
                        }
                    }
                }

                this._unscale();
            }
        }
        
        
        bounding_group(pars) {
            if ( !pars ) return
            let selections = pars.selections;
            //
            if ( selections && Array.isArray(selections) ) {
                let group_objects = selections.map((ith) => {
                    return this.ith_object(ith)
                });
                group_objects = group_objects.filter((obj) => {
                    return obj !== false
                });
                let group_boxes = group_objects.map(obj => {
                    return obj.bounds
                });
                let bound_box = max_box(group_boxes);
                pars.points = bound_box;
                this.group(pars);
            }
            //
        }


        search_selection_toggle(pars) {
            if ( !pars ) return
            let descriptor = this.z_top_object();
            if ( descriptor.shape === 'group' ) {
                let children = descriptor.children;
                if ( !children ) {
                    let mouse_loc = pars.mouse_loc;
                    let found_shapes = this.mouse_in_shapes_all(mouse_loc);
                    if ( !found_shapes ) return
                    //
                    let depth = pars.depth ? parseInt(pars.depth) : 1;

                    found_shapes.sort();
                    found_shapes.reverse();
                    let exclusions = descriptor.exclusion_list;
                    if ( exclusions === undefined || !Array.isArray(exclusions) ) {
                        exclusions = [];
                        descriptor.exclusion_list = exclusions;
                    }
                    //
                    if ( found_shapes.length ) {  // z_top()
                        if ( found_shapes[0] === this.z_top() ) {
                            found_shapes.shift();
                        }
                        while ( found_shapes.length && (depth > 0) ) {
                            depth--;
                            let ith = found_shapes.shift();
                            let ex_ith = exclusions.indexOf(ith);
                            if ( ex_ith >= 0 ) {
                                exclusions.splice(ex_ith,1);
                            } else {
                                exclusions.push(ith);
                            }
                        }
                    }
                    //
                }
            }

        }

        remove_top_if_empty_group(pars) {
            if ( !pars ) return
            let descriptor = this.z_top_object();
            if ( descriptor.shape === 'group' ) {
                let children = descriptor.children;
                if ( !children ) {
                    let exception = pars.except;
                    if ( (exception !== undefined) && (this.selected === exception) ) return
                    this.z_list.pop();
                }
            }
        }


        update_selector_group(pars) {
            if ( !pars ) return
            let descriptor = this.z_top_object();
            if ( descriptor.shape === 'group' ) {
                let children = descriptor.children;
                if ( !children ) {
                    descriptor.select_list = pars.list;
                    descriptor.do_draw_selections = true;
                }
            }
        }

    }

    /* src/CanDraw.svelte generated by Svelte v3.44.1 */

    function add_css(target) {
    	append_styles(target, "svelte-1nja3vi", ".canvas-viz.svelte-1nja3vi{border:solid 1px black;position:absolute}");
    }

    function create_fragment(ctx) {
    	let div;
    	let canvas;
    	let canvas_height_value;
    	let canvas_width_value;
    	let mounted;
    	let dispose;

    	return {
    		c() {
    			div = element("div");
    			canvas = element("canvas");
    			attr(canvas, "class", "canvas-viz svelte-1nja3vi");
    			attr(canvas, "height", canvas_height_value = "" + (/*height*/ ctx[0] + "px"));
    			attr(canvas, "width", canvas_width_value = "" + (/*width*/ ctx[1] + "px"));
    			set_style(canvas, "width", /*doc_width*/ ctx[3] + "px");
    			set_style(canvas, "height", /*doc_height*/ ctx[2] + "px");
    			set_style(canvas, "left", /*doc_left*/ ctx[4] + "px");
    			set_style(canvas, "top", /*doc_top*/ ctx[5] + "px");
    		},
    		m(target, anchor) {
    			insert(target, div, anchor);
    			append(div, canvas);
    			/*canvas_binding*/ ctx[18](canvas);

    			if (!mounted) {
    				dispose = listen(canvas, "mousemove", /*mouse_move*/ ctx[7]);
    				mounted = true;
    			}
    		},
    		p(ctx, [dirty]) {
    			if (dirty & /*height*/ 1 && canvas_height_value !== (canvas_height_value = "" + (/*height*/ ctx[0] + "px"))) {
    				attr(canvas, "height", canvas_height_value);
    			}

    			if (dirty & /*width*/ 2 && canvas_width_value !== (canvas_width_value = "" + (/*width*/ ctx[1] + "px"))) {
    				attr(canvas, "width", canvas_width_value);
    			}

    			if (dirty & /*doc_width*/ 8) {
    				set_style(canvas, "width", /*doc_width*/ ctx[3] + "px");
    			}

    			if (dirty & /*doc_height*/ 4) {
    				set_style(canvas, "height", /*doc_height*/ ctx[2] + "px");
    			}

    			if (dirty & /*doc_left*/ 16) {
    				set_style(canvas, "left", /*doc_left*/ ctx[4] + "px");
    			}

    			if (dirty & /*doc_top*/ 32) {
    				set_style(canvas, "top", /*doc_top*/ ctx[5] + "px");
    			}
    		},
    		i: noop,
    		o: noop,
    		d(detaching) {
    			if (detaching) detach(div);
    			/*canvas_binding*/ ctx[18](null);
    			mounted = false;
    			dispose();
    		}
    	};
    }

    function instance($$self, $$props, $$invalidate) {
    	let { height = 460 } = $$props;
    	let { width = 680 } = $$props;
    	let { doc_height = height } = $$props;
    	let { doc_width = width } = $$props;
    	let { doc_left = 0 } = $$props;
    	let { doc_top = 0 } = $$props;
    	let { selected = false } = $$props;
    	let { mouse_to_shape = false } = $$props;
    	let { secondary_shape = false } = $$props;
    	let { multi_select = false } = $$props;
    	let { z_list = false } = $$props;
    	let { canvas_mouse = { x: 0, y: 0 } } = $$props;
    	let { canvas_changed = false } = $$props;
    	let { internal_draw = false } = $$props;
    	let old_canvas_left = doc_left;
    	let old_canvas_top = doc_top;

    	// ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ----
    	//
    	let the_canvas;

    	let ctxt = false;
    	let drawit = false;

    	g_commander.subscribe(command => {
    		if (!drawit) return;

    		if (!ctxt && the_canvas) {
    			$$invalidate(16, ctxt = the_canvas.getContext("2d"));
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
    			if (pars.no_change) {
    				$$invalidate(10, secondary_shape = drawit.mouse_in_shape(pars));
    			} else {
    				$$invalidate(9, mouse_to_shape = drawit.mouse_in_shape(pars));
    			}
    		} else if (command.multi_select !== undefined) {
    			$$invalidate(11, multi_select = drawit.all_bounds_intersect(pars));
    		} else if (command.z_list !== undefined) {
    			$$invalidate(12, z_list = drawit.z_list_deep_clone());
    		}

    		//
    		$$invalidate(8, selected = drawit.selected_object());
    	});

    	let resize_happening = false;

    	afterUpdate(() => {
    		if (drawit) {
    			drawit.canvas_size(width, height);
    			drawit.clear();
    			drawit.redraw();
    		}

    		if (resize_happening) {
    			const rect = the_canvas.getBoundingClientRect();
    			console.log(`changed canvas later maybe: ${rect.left} ${rect.top}`);
    			resize_happening = false;
    			$$invalidate(14, canvas_changed = true);
    		}
    	}); //console.log(`canvas_changed ${canvas_changed}`)

    	function mouse_move(evt) {
    		const rect = the_canvas.getBoundingClientRect();
    		$$invalidate(13, canvas_mouse.x = evt.clientX - rect.left, canvas_mouse);
    		$$invalidate(13, canvas_mouse.y = evt.clientY - rect.top, canvas_mouse);
    	}

    	function canvas_binding($$value) {
    		binding_callbacks[$$value ? 'unshift' : 'push'](() => {
    			the_canvas = $$value;
    			$$invalidate(6, the_canvas);
    		});
    	}

    	$$self.$$set = $$props => {
    		if ('height' in $$props) $$invalidate(0, height = $$props.height);
    		if ('width' in $$props) $$invalidate(1, width = $$props.width);
    		if ('doc_height' in $$props) $$invalidate(2, doc_height = $$props.doc_height);
    		if ('doc_width' in $$props) $$invalidate(3, doc_width = $$props.doc_width);
    		if ('doc_left' in $$props) $$invalidate(4, doc_left = $$props.doc_left);
    		if ('doc_top' in $$props) $$invalidate(5, doc_top = $$props.doc_top);
    		if ('selected' in $$props) $$invalidate(8, selected = $$props.selected);
    		if ('mouse_to_shape' in $$props) $$invalidate(9, mouse_to_shape = $$props.mouse_to_shape);
    		if ('secondary_shape' in $$props) $$invalidate(10, secondary_shape = $$props.secondary_shape);
    		if ('multi_select' in $$props) $$invalidate(11, multi_select = $$props.multi_select);
    		if ('z_list' in $$props) $$invalidate(12, z_list = $$props.z_list);
    		if ('canvas_mouse' in $$props) $$invalidate(13, canvas_mouse = $$props.canvas_mouse);
    		if ('canvas_changed' in $$props) $$invalidate(14, canvas_changed = $$props.canvas_changed);
    		if ('internal_draw' in $$props) $$invalidate(15, internal_draw = $$props.internal_draw);
    	};

    	$$self.$$.update = () => {
    		if ($$self.$$.dirty & /*the_canvas, drawit, ctxt, width, height*/ 196675) {
    			if (the_canvas && !drawit) {
    				$$invalidate(16, ctxt = the_canvas.getContext("2d"));
    				$$invalidate(17, drawit = new DrawTools(ctxt, width, height));
    				$$invalidate(15, internal_draw = drawit);
    			}
    		}

    		if ($$self.$$.dirty & /*doc_left, doc_top*/ 48) {
    			{
    				if (old_canvas_left !== doc_left || old_canvas_top !== doc_top) {
    					resize_happening = true;
    				}
    			}
    		}
    	};

    	return [
    		height,
    		width,
    		doc_height,
    		doc_width,
    		doc_left,
    		doc_top,
    		the_canvas,
    		mouse_move,
    		selected,
    		mouse_to_shape,
    		secondary_shape,
    		multi_select,
    		z_list,
    		canvas_mouse,
    		canvas_changed,
    		internal_draw,
    		ctxt,
    		drawit,
    		canvas_binding
    	];
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
    				doc_height: 2,
    				doc_width: 3,
    				doc_left: 4,
    				doc_top: 5,
    				selected: 8,
    				mouse_to_shape: 9,
    				secondary_shape: 10,
    				multi_select: 11,
    				z_list: 12,
    				canvas_mouse: 13,
    				canvas_changed: 14,
    				internal_draw: 15
    			},
    			add_css
    		);
    	}
    }

    CanDraw.draw_model = draw_model;

    return CanDraw;

}));
