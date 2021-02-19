import {terser} from "rollup-plugin-terser";
import resolve from '@rollup/plugin-node-resolve';
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodePolyfills from 'rollup-plugin-node-polyfills';

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
    plugins: [commonjs(), nodePolyfills(), resolve(), json()],
};
