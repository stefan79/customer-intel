import ejs from "ejs";


export function generatePrompt(template, context) {
    const entries = Object.entries(template ?? {}).map(([key, value]) => [
        key,
        ejs.render(value, context),
    ])
    return Object.fromEntries(entries)
}

