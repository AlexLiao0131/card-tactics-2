export function equippedItems(character){return[...Object.values(character?.weapons||{}),character?.armor,...(character?.equipment||[]),character?.guard].filter(Boolean)}
