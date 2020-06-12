module.exports = {
    trailingComma: "es5",
    tabWidth: 4,
    semi: true,
    singleQuote: true,
    printWidth: 150,

    overrides: [
        {
            files: ["*.json", "*.yml", "*.yaml"],
            options: {
                tabWidth: 2,
            },
        },
        {
            files: ["*.ts", "*.tsx"],
            options: {
                semi: false,
            },
        },
    ],
};
