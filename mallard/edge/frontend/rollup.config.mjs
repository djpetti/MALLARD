import terser from "@rollup/plugin-terser"
import resolve from '@rollup/plugin-node-resolve';
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodePolyfills from 'rollup-plugin-polyfill-node';
import sourcemaps from "rollup-plugin-sourcemaps";
import scss from "rollup-plugin-scss";
import copy from "rollup-plugin-copy";

export default {
    input: 'build/index.js',
    output: [
        {
            file: 'bundled/mallard-edge.js',
            sourcemap: true,
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
                compress: { evaluate: false }
            }),
            ],
        },
    ],
    onwarn(warning) {
        if (warning.code !== 'THIS_IS_UNDEFINED') {
            console.error(`(!) ${warning.message}`);
        }
    },
    plugins: [sourcemaps(), commonjs(), nodePolyfills(), resolve(), json(),
        scss({fileName: "mallard-edge.css"}),
        copy({
            targets: [{
                src: 'static/*',
                dest: 'bundled/'
            }]
        }),
    ],
};
