<script>
    import { g_commander } from "./draw_model"
    import { DrawTools } from "./do_draw"
    import { afterUpdate } from 'svelte';

    export let height = 460
    export let width = 680

    export let doc_height = height
    export let doc_width = width
    export let doc_left = 0
    export let doc_top = 0

    export let selected = false
    export let mouse_to_shape = false

    export let canvas_mouse = { x: 0, y: 0 }

    // ---- ---- ---- ---- ---- ---- ---- ---- ---- ---- ----
    //
    let the_canvas
    let ctxt = false
    let drawit = false
    $: if ( the_canvas && !drawit ) {
        ctxt = the_canvas.getContext("2d");
        drawit = new DrawTools(ctxt,width,height)
    }

    g_commander.subscribe((command) => {
        if ( !drawit ) return
        if ( !ctxt && the_canvas )  {
            ctxt = the_canvas.getContext("2d");
            drawit.setContext(ctxt)
        }
        //
        let pars = command.pars
        if ( command.shape !== undefined ) {
            let shape = command.shape
            drawit[shape](pars)
        } else if ( command.command !== undefined  ) {
            let cmd = command.command
            drawit[cmd](pars)
        } else if ( command.update !== undefined ) {
            drawit.update(pars)
        } else if ( command.searching !== undefined ) {
            mouse_to_shape = drawit.mouse_in_shape(pars)
        }

        selected = drawit.selected_object()
    })

    afterUpdate(() => {
        if ( drawit ) {
            drawit.canvas_size(width,height)
            drawit.redraw()
        }
    })

    function mouse_move(evt) {
        const rect = the_canvas.getBoundingClientRect()
        canvas_mouse.x = evt.clientX - rect.left
        canvas_mouse.y = evt.clientY - rect.top
    }

</script>
<div>
<canvas  bind:this={the_canvas} class="canvas-viz" height='{height}px'  
            width='{width}px' style="width:{doc_width}px;height:{doc_height}px;left:{doc_left}px;top:{doc_top}px"
            on:mousemove={mouse_move} >

</canvas>
</div>
<style>

	.canvas-viz {
		border: solid 1px black;
        position: absolute;
	}

</style>
