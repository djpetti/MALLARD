import {terser} from "rollup-plugin-terser";
import resolve from '@rollup/plugin-node-resolve';

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
            plugins: [terser({
                module: true,
                warnings: true,
                mangle: {
                    properties: {
                        regex: /^__/,
                    },
                },
            }),
            ],
        },
    ],
    onwarn(warning) {
        if (warning.code !== 'THIS_IS_UNDEFINED') {
            console.error(`(!) ${warning.message}`);
        }
    },
    plugins: [resolve()],
};
