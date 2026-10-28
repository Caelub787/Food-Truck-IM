// Starter kits fill in common supplies, products, recipes, and add ons so a
// new business isn't starting from a blank page. Every number is a starting
// guess: costs are left at zero and everything can be edited or turned off.

export type KitSupply = {
  name: string
  category: string
  base_unit: string
  units: { name: string; factor: number }[]
  count_unit?: string
  purchase_unit?: string
  group?: string
  reorder_level?: number // in count units
  order_up_to?: number // in count units
  whole_only?: boolean
  tracks_expiration?: boolean
  shelf_life_days?: number
  count_check?: boolean
}

export type KitProduct = {
  name: string
  category: string
  sizes: { name: string; price: number; recipe: { supply: string; amount: number; unit?: string }[] }[]
}

export type KitAddOnGroup = {
  name: string
  products: string[]
  addOns: {
    name: string
    price: number
    effects: ({ kind: 'add'; supply: string; amount: number; unit?: string; size?: string } | { kind: 'swap'; from: string; to: string })[]
  }[]
}

export type StarterKit = {
  id: string
  name: string
  description: string
  truckType: string
  groups: { name: string; base_unit: string }[]
  supplies: KitSupply[]
  products: KitProduct[]
  addOnGroups: KitAddOnGroup[]
}

const cups = (sizes: string[], label: string): KitSupply[] =>
  sizes.map((size) => ({
    name: `${size} ${label}`,
    category: 'Cups and lids',
    base_unit: 'each',
    units: [
      { name: 'sleeve', factor: 50 },
      { name: 'case', factor: 1000 },
    ],
    count_unit: 'sleeve',
    purchase_unit: 'case',
    reorder_level: 10,
    order_up_to: 40,
    whole_only: false,
    count_check: true,
  }))

const syrup = (flavor: string): KitSupply => ({
  name: `${flavor} syrup`,
  category: 'Syrup',
  base_unit: 'oz',
  units: [
    { name: 'gallon', factor: 128 },
    { name: 'case', factor: 512 },
  ],
  count_unit: 'gallon',
  purchase_unit: 'case',
  group: 'Syrups (any flavor)',
  reorder_level: 2,
  order_up_to: 8,
})

export const starterKits: StarterKit[] = [
  {
    id: 'shaved-ice',
    name: 'Shaved ice truck',
    description: 'Ice, six syrup flavors in one group (guests pick their own), four cup sizes, spoon straws, and napkins.',
    truckType: 'Shaved ice',
    groups: [{ name: 'Syrups (any flavor)', base_unit: 'oz' }],
    supplies: [
      {
        name: 'Ice',
        category: 'Ice',
        base_unit: 'lb',
        units: [{ name: 'bag', factor: 10 }],
        count_unit: 'bag',
        purchase_unit: 'bag',
        reorder_level: 20,
        order_up_to: 60,
      },
      ...['Cherry', 'Blue raspberry', 'Grape', 'Lemon lime', 'Strawberry', 'Mango'].map(syrup),
      ...cups(['Kid', 'Small', 'Medium', 'Large'], 'shaved ice cup'),
      {
        name: 'Spoon straws',
        category: 'Utensils',
        base_unit: 'each',
        units: [
          { name: 'box', factor: 200 },
          { name: 'case', factor: 2000 },
        ],
        count_unit: 'box',
        purchase_unit: 'case',
        reorder_level: 4,
        order_up_to: 20,
      },
      {
        name: 'Napkins',
        category: 'Paper',
        base_unit: 'each',
        units: [
          { name: 'pack', factor: 250 },
          { name: 'case', factor: 3000 },
        ],
        count_unit: 'pack',
        purchase_unit: 'case',
        reorder_level: 4,
        order_up_to: 24,
      },
    ],
    products: [
      {
        name: 'Shaved ice',
        category: 'Shaved ice',
        sizes: [
          ['Kid', 3, 0.25, 1.5],
          ['Small', 4, 0.4, 2],
          ['Medium', 5, 0.6, 3],
          ['Large', 6, 0.8, 4],
        ].map(([size, price, ice, syrupOz]) => ({
          name: size as string,
          price: price as number,
          recipe: [
            { supply: `${size} shaved ice cup`, amount: 1 },
            { supply: 'Spoon straws', amount: 1 },
            { supply: 'Napkins', amount: 2 },
            { supply: 'Ice', amount: ice as number, unit: 'lb' },
            { supply: 'Syrups (any flavor)', amount: syrupOz as number },
          ],
        })),
      },
    ],
    addOnGroups: [],
  },
  {
    id: 'coffee',
    name: 'Coffee truck',
    description: 'Espresso, whole and oat milk, two flavor syrups, three hot cup sizes, lids, sleeves, lattes, americanos, and add ons.',
    truckType: 'Coffee',
    groups: [],
    supplies: [
      {
        name: 'Espresso beans',
        category: 'Coffee',
        base_unit: 'g',
        units: [
          { name: 'shot', factor: 9 },
          { name: 'bag', factor: 2268 },
        ],
        count_unit: 'bag',
        purchase_unit: 'bag',
        reorder_level: 3,
        order_up_to: 10,
      },
      ...['Whole milk', 'Oat milk'].map<KitSupply>((name) => ({
        name,
        category: 'Milk',
        base_unit: 'oz',
        units: [
          { name: 'half gallon', factor: 64 },
          { name: 'case', factor: 384 },
        ],
        count_unit: 'half gallon',
        purchase_unit: 'case',
        reorder_level: 6,
        order_up_to: 24,
        tracks_expiration: true,
        shelf_life_days: name === 'Whole milk' ? 10 : 30,
      })),
      ...['Vanilla', 'Caramel'].map<KitSupply>((flavor) => ({
        name: `${flavor} syrup`,
        category: 'Syrup',
        base_unit: 'oz',
        units: [
          { name: 'bottle', factor: 25.4 },
          { name: 'case', factor: 152.4 },
        ],
        count_unit: 'bottle',
        purchase_unit: 'case',
        reorder_level: 2,
        order_up_to: 6,
      })),
      ...cups(['12 oz', '16 oz', '20 oz'], 'hot cup'),
      {
        name: 'Hot cup lids',
        category: 'Cups and lids',
        base_unit: 'each',
        units: [
          { name: 'sleeve', factor: 50 },
          { name: 'case', factor: 1000 },
        ],
        count_unit: 'sleeve',
        purchase_unit: 'case',
        reorder_level: 10,
        order_up_to: 40,
      },
      {
        name: 'Cup sleeves',
        category: 'Cups and lids',
        base_unit: 'each',
        units: [
          { name: 'pack', factor: 100 },
          { name: 'case', factor: 1200 },
        ],
        count_unit: 'pack',
        purchase_unit: 'case',
        reorder_level: 4,
        order_up_to: 20,
      },
    ],
    products: [
      {
        name: 'Latte',
        category: 'Espresso drinks',
        sizes: [
          ['Small', '12 oz', 4.5, 2, 8],
          ['Medium', '16 oz', 5, 2, 10],
          ['Large', '20 oz', 5.5, 3, 14],
        ].map(([size, cup, price, shots, milk]) => ({
          name: size as string,
          price: price as number,
          recipe: [
            { supply: 'Espresso beans', amount: shots as number, unit: 'shot' },
            { supply: 'Whole milk', amount: milk as number, unit: 'oz' },
            { supply: `${cup} hot cup`, amount: 1 },
            { supply: 'Hot cup lids', amount: 1 },
            { supply: 'Cup sleeves', amount: 1 },
          ],
        })),
      },
      {
        name: 'Americano',
        category: 'Espresso drinks',
        sizes: [
          ['Small', '12 oz', 3.5, 2],
          ['Medium', '16 oz', 4, 2],
          ['Large', '20 oz', 4.5, 3],
        ].map(([size, cup, price, shots]) => ({
          name: size as string,
          price: price as number,
          recipe: [
            { supply: 'Espresso beans', amount: shots as number, unit: 'shot' },
            { supply: `${cup} hot cup`, amount: 1 },
            { supply: 'Hot cup lids', amount: 1 },
            { supply: 'Cup sleeves', amount: 1 },
          ],
        })),
      },
    ],
    addOnGroups: [
      {
        name: 'Milk',
        products: ['Latte'],
        addOns: [{ name: 'Oat milk', price: 0.75, effects: [{ kind: 'swap', from: 'Whole milk', to: 'Oat milk' }] }],
      },
      {
        name: 'Extras',
        products: ['Latte', 'Americano'],
        addOns: [
          { name: 'Extra shot', price: 1, effects: [{ kind: 'add', supply: 'Espresso beans', amount: 1, unit: 'shot' }] },
          { name: 'Vanilla', price: 0.5, effects: [{ kind: 'add', supply: 'Vanilla syrup', amount: 1, unit: 'oz' }] },
          { name: 'Caramel', price: 0.5, effects: [{ kind: 'add', supply: 'Caramel syrup', amount: 1, unit: 'oz' }] },
        ],
      },
    ],
  },
]
