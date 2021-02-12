import {terser} from "rollup-plugin-terser";

export default {
    input: 'build/index.js',
    output: [
        {
            file: 'bundled/mallard-edge.js',
            format: 'esm',
        },
        {
            file: 'bundled/mallard-edge.min.js',
            format: 'iife',
            name: 'version',
            plugins: [terser()]
        }
    ]
};
