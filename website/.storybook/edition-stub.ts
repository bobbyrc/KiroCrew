// Storybook-only stub for the edition seam's virtual modules
// (`virtual:kirocrew-edition` and `virtual:kirocrew-edition-languages`), which
// the app's own vite.config.ts provides but the Storybook builder does not.
// The stock public build resolves both to "nothing": the base module is
// imported for its side effect only, and the languages module default-exports
// an empty list. Aliasing to a real file (below, in vite.config.ts) is more
// robust under the Storybook rolldown builder than the `\0`-virtual plugin
// convention, which never resolved a built story that imported it.
export default []
