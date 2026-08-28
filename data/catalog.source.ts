import { colorways } from "../src/tokens";
import type { ColorwayId } from "../src/tokens";
import type { CatalogItem, Category } from "../src/engine/types";

type StyleTag = "scandinavian" | "japandi" | "mid-century" | "rustic" | "modern" | "coastal";
type Spec = {
  id: string;
  name: string;
  category: Category;
  dims: [number, number, number];
  price: number;
  colors: ColorwayId[];
  styles: StyleTag[];
  seats?: number;
};

const clearance: Record<Category, number> = {
  sofa: 75, armchair: 75, bed: 60, wardrobe: 70, table: 75, desk: 90, chair: 45,
  shelf: 70, "tv-unit": 70, rug: 0, "floor-lamp": 0, "table-lamp": 0, plant: 0, decor: 0,
};

const wallCategories = new Set<Category>(["sofa", "bed", "wardrobe", "desk", "shelf", "tv-unit"]);

const descriptions: Record<Category, string> = {
  sofa: "A deep, softly structured sofa with a timber base and enough firmness for everyday sitting.",
  armchair: "A compact lounge chair with a supportive back, rounded arms and a warm timber detail.",
  bed: "A low upholstered bed with a quiet headboard and practical clearance beneath the frame.",
  wardrobe: "A full-height wardrobe with simple doors, useful interior depth and a restrained timber face.",
  table: "A balanced dining table with durable joinery and comfortable knee room around every side.",
  desk: "A straightforward work desk with a calm surface, cable space and room for a proper task chair.",
  chair: "A light dining chair with a supportive curved back and a footprint that is easy to move around.",
  shelf: "An open storage shelf with steady proportions for books, baskets and a few personal objects.",
  "tv-unit": "A low media cabinet with closed storage, cable access and a top deep enough for a television.",
  rug: "A flat-woven rug with a soft hand and a quiet pattern that settles a seating or dining group.",
  "floor-lamp": "A slender floor lamp that gives warm, local light without taking much usable floor space.",
  "table-lamp": "A small table lamp with a shaded, warm pool of light for a desk, shelf or bedside surface.",
  plant: "A leafy indoor plant in a simple matte pot, sized to soften a corner without crowding a walkway.",
  decor: "A small, tactile object with a natural finish for adding scale and warmth to an open surface.",
};

const specs: Spec[] = [
  { id: "sofa-endre", name: "Endre Sofa", category: "sofa", dims: [220, 95, 85], price: 790, colors: ["oak", "sage", "terracotta"], styles: ["scandinavian"], seats: 3 },
  { id: "sofa-fjord", name: "Fjord Sofa", category: "sofa", dims: [260, 100, 82], price: 1290, colors: ["plaster", "dusty-blue", "charcoal"], styles: ["scandinavian", "coastal"], seats: 4 },
  { id: "sofa-liva", name: "Liva Sofa", category: "sofa", dims: [180, 88, 80], price: 690, colors: ["sage", "plaster", "ochre"], styles: ["japandi", "modern"], seats: 2 },
  { id: "sofa-maren", name: "Maren Sofa", category: "sofa", dims: [240, 98, 84], price: 1090, colors: ["terracotta", "plum", "charcoal"], styles: ["mid-century"], seats: 3 },
  { id: "sofa-svale", name: "Svale Sofa", category: "sofa", dims: [200, 92, 78], price: 890, colors: ["plaster", "oak", "dusty-blue"], styles: ["scandinavian", "japandi"], seats: 3 },

  { id: "armchair-nook", name: "Nook Armchair", category: "armchair", dims: [78, 82, 84], price: 390, colors: ["sage", "terracotta", "plaster"], styles: ["scandinavian", "japandi"], seats: 1 },
  { id: "armchair-elsa", name: "Elsa Armchair", category: "armchair", dims: [72, 78, 80], price: 320, colors: ["dusty-blue", "plaster"], styles: ["coastal", "modern"], seats: 1 },
  { id: "armchair-kyst", name: "Kyst Armchair", category: "armchair", dims: [84, 86, 82], price: 460, colors: ["ochre", "charcoal", "oak"], styles: ["mid-century"], seats: 1 },
  { id: "armchair-ro", name: "Ro Armchair", category: "armchair", dims: [76, 80, 76], price: 350, colors: ["plum", "sage", "plaster"], styles: ["japandi"], seats: 1 },
  { id: "armchair-tuva", name: "Tuva Armchair", category: "armchair", dims: [80, 84, 88], price: 420, colors: ["terracotta", "oak", "charcoal"], styles: ["rustic", "scandinavian"], seats: 1 },

  { id: "bed-birk", name: "Birk Bed", category: "bed", dims: [160, 200, 105], price: 990, colors: ["oak", "sage", "plaster"], styles: ["scandinavian", "japandi"] },
  { id: "bed-ask", name: "Ask Bed", category: "bed", dims: [140, 200, 98], price: 690, colors: ["plaster", "dusty-blue"], styles: ["coastal", "scandinavian"] },
  { id: "bed-viggo", name: "Viggo Bed", category: "bed", dims: [180, 200, 110], price: 1490, colors: ["charcoal", "plum", "oak"], styles: ["modern", "mid-century"] },
  { id: "bed-lyng", name: "Lyng Bed", category: "bed", dims: [160, 200, 95], price: 890, colors: ["sage", "oak", "ochre"], styles: ["rustic", "japandi"] },
  { id: "bed-siv", name: "Siv Bed", category: "bed", dims: [180, 200, 102], price: 1190, colors: ["terracotta", "plaster", "charcoal"], styles: ["scandinavian", "modern"] },

  { id: "wardrobe-hald", name: "Hald Wardrobe", category: "wardrobe", dims: [160, 60, 200], price: 890, colors: ["oak", "plaster", "charcoal"], styles: ["scandinavian", "modern"] },
  { id: "wardrobe-skive", name: "Skive Wardrobe", category: "wardrobe", dims: [100, 60, 190], price: 590, colors: ["plaster", "sage"], styles: ["japandi"] },
  { id: "wardrobe-nord", name: "Nord Wardrobe", category: "wardrobe", dims: [200, 60, 210], price: 1190, colors: ["oak", "charcoal"], styles: ["scandinavian", "rustic"] },
  { id: "wardrobe-eira", name: "Eira Wardrobe", category: "wardrobe", dims: [140, 58, 200], price: 760, colors: ["dusty-blue", "plaster", "oak"], styles: ["coastal", "modern"] },
  { id: "wardrobe-tor", name: "Tor Wardrobe", category: "wardrobe", dims: [180, 62, 205], price: 990, colors: ["plum", "charcoal", "oak"], styles: ["mid-century"] },

  { id: "table-rove", name: "Rove Table", category: "table", dims: [160, 90, 75], price: 590, colors: ["oak", "charcoal"], styles: ["scandinavian", "modern"] },
  { id: "table-ake", name: "Ake Table", category: "table", dims: [120, 80, 74], price: 420, colors: ["oak", "plaster"], styles: ["japandi"] },
  { id: "table-elm", name: "Elm Table", category: "table", dims: [200, 95, 76], price: 890, colors: ["oak", "terracotta", "charcoal"], styles: ["rustic", "mid-century"] },
  { id: "table-rund", name: "Rund Table", category: "table", dims: [110, 110, 75], price: 490, colors: ["plaster", "sage", "oak"], styles: ["scandinavian"] },
  { id: "table-petit", name: "Petit Table", category: "table", dims: [80, 80, 74], price: 330, colors: ["ochre", "oak"], styles: ["modern", "coastal"] },

  { id: "desk-aalto", name: "Aalto Desk", category: "desk", dims: [140, 70, 75], price: 490, colors: ["oak", "sage", "charcoal"], styles: ["scandinavian", "japandi"] },
  { id: "desk-soren", name: "Soren Desk", category: "desk", dims: [120, 60, 74], price: 390, colors: ["plaster", "oak"], styles: ["modern"] },
  { id: "desk-kari", name: "Kari Desk", category: "desk", dims: [160, 80, 76], price: 690, colors: ["charcoal", "oak", "terracotta"], styles: ["mid-century"] },
  { id: "desk-linn", name: "Linn Desk", category: "desk", dims: [130, 65, 75], price: 450, colors: ["dusty-blue", "plaster", "oak"], styles: ["coastal", "scandinavian"] },
  { id: "desk-varde", name: "Varde Desk", category: "desk", dims: [150, 75, 75], price: 590, colors: ["sage", "oak", "plum"], styles: ["rustic", "japandi"] },

  { id: "chair-finn", name: "Finn Chair", category: "chair", dims: [45, 50, 82], price: 140, colors: ["oak", "sage", "charcoal"], styles: ["scandinavian"], seats: 1 },
  { id: "chair-ida", name: "Ida Chair", category: "chair", dims: [46, 52, 80], price: 120, colors: ["plaster", "dusty-blue"], styles: ["coastal"], seats: 1 },
  { id: "chair-lars", name: "Lars Chair", category: "chair", dims: [48, 52, 84], price: 190, colors: ["terracotta", "oak", "charcoal"], styles: ["mid-century"], seats: 1 },
  { id: "chair-mysa", name: "Mysa Chair", category: "chair", dims: [44, 49, 79], price: 110, colors: ["sage", "plaster"], styles: ["japandi"], seats: 1 },
  { id: "chair-olve", name: "Olve Chair", category: "chair", dims: [47, 51, 83], price: 160, colors: ["ochre", "oak", "plum"], styles: ["rustic", "modern"], seats: 1 },

  { id: "shelf-kant", name: "Kant Shelf", category: "shelf", dims: [100, 35, 190], price: 390, colors: ["oak", "charcoal"], styles: ["scandinavian", "modern"] },
  { id: "shelf-lund", name: "Lund Shelf", category: "shelf", dims: [80, 30, 180], price: 290, colors: ["plaster", "oak"], styles: ["japandi"] },
  { id: "shelf-rune", name: "Rune Shelf", category: "shelf", dims: [120, 40, 200], price: 490, colors: ["oak", "terracotta", "charcoal"], styles: ["rustic"] },
  { id: "shelf-saga", name: "Saga Shelf", category: "shelf", dims: [90, 32, 185], price: 340, colors: ["sage", "plaster", "oak"], styles: ["coastal", "scandinavian"] },
  { id: "shelf-vik", name: "Vik Shelf", category: "shelf", dims: [110, 38, 195], price: 440, colors: ["plum", "charcoal", "oak"], styles: ["mid-century"] },

  { id: "tv-unit-linje", name: "Linje TV Unit", category: "tv-unit", dims: [180, 40, 50], price: 590, colors: ["oak", "charcoal", "plaster"], styles: ["scandinavian", "modern"] },
  { id: "tv-unit-form", name: "Form TV Unit", category: "tv-unit", dims: [140, 40, 48], price: 430, colors: ["plaster", "oak"], styles: ["japandi"] },
  { id: "tv-unit-nova", name: "Nova TV Unit", category: "tv-unit", dims: [200, 42, 52], price: 720, colors: ["charcoal", "plum", "oak"], styles: ["mid-century"] },
  { id: "tv-unit-sund", name: "Sund TV Unit", category: "tv-unit", dims: [160, 38, 48], price: 510, colors: ["dusty-blue", "plaster", "oak"], styles: ["coastal"] },
  { id: "tv-unit-ved", name: "Ved TV Unit", category: "tv-unit", dims: [170, 40, 50], price: 560, colors: ["terracotta", "oak", "charcoal"], styles: ["rustic", "modern"] },

  { id: "rug-loop", name: "Loop Rug", category: "rug", dims: [200, 300, 2], price: 390, colors: ["sage", "terracotta", "plaster"], styles: ["scandinavian", "japandi"] },
  { id: "rug-flette", name: "Flette Rug", category: "rug", dims: [160, 230, 2], price: 240, colors: ["oak", "plaster", "dusty-blue"], styles: ["coastal"] },
  { id: "rug-mark", name: "Mark Rug", category: "rug", dims: [240, 340, 2], price: 590, colors: ["charcoal", "terracotta", "ochre"], styles: ["modern", "mid-century"] },
  { id: "rug-siv", name: "Siv Rug", category: "rug", dims: [200, 300, 2], price: 420, colors: ["plum", "sage", "plaster"], styles: ["japandi"] },
  { id: "rug-ull", name: "Ull Rug", category: "rug", dims: [160, 230, 3], price: 290, colors: ["oak", "ochre", "charcoal"], styles: ["rustic", "scandinavian"] },

  { id: "lamp-glow", name: "Glow Floor Lamp", category: "floor-lamp", dims: [30, 30, 150], price: 190, colors: ["ochre", "charcoal", "oak"], styles: ["scandinavian", "modern"] },
  { id: "floor-lamp-arc", name: "Arc Floor Lamp", category: "floor-lamp", dims: [35, 35, 165], price: 260, colors: ["charcoal", "plaster"], styles: ["mid-century"] },
  { id: "floor-lamp-sol", name: "Sol Floor Lamp", category: "floor-lamp", dims: [30, 30, 155], price: 170, colors: ["ochre", "terracotta"], styles: ["rustic", "scandinavian"] },
  { id: "floor-lamp-lyst", name: "Lyst Floor Lamp", category: "floor-lamp", dims: [28, 28, 145], price: 140, colors: ["plaster", "oak", "sage"], styles: ["japandi"] },
  { id: "floor-lamp-havn", name: "Havn Floor Lamp", category: "floor-lamp", dims: [32, 32, 158], price: 220, colors: ["dusty-blue", "charcoal", "plaster"], styles: ["coastal", "modern"] },

  { id: "table-lamp-alva", name: "Alva Table Lamp", category: "table-lamp", dims: [22, 22, 38], price: 120, colors: ["ochre", "plaster", "oak"], styles: ["scandinavian"] },
  { id: "table-lamp-natt", name: "Natt Table Lamp", category: "table-lamp", dims: [20, 20, 34], price: 90, colors: ["charcoal", "plum"], styles: ["modern"] },
  { id: "table-lamp-lune", name: "Lune Table Lamp", category: "table-lamp", dims: [24, 24, 40], price: 150, colors: ["plaster", "dusty-blue", "ochre"], styles: ["coastal"] },
  { id: "table-lamp-ember", name: "Ember Table Lamp", category: "table-lamp", dims: [21, 21, 36], price: 130, colors: ["terracotta", "oak"], styles: ["rustic", "mid-century"] },
  { id: "table-lamp-moss", name: "Moss Table Lamp", category: "table-lamp", dims: [23, 23, 37], price: 140, colors: ["sage", "plaster", "charcoal"], styles: ["japandi"] },

  { id: "plant-fern", name: "Fern Plant", category: "plant", dims: [50, 50, 110], price: 75, colors: ["sage", "terracotta", "plaster"], styles: ["scandinavian", "coastal"] },
  { id: "plant-fig", name: "Fig Plant", category: "plant", dims: [60, 60, 160], price: 120, colors: ["sage", "charcoal"], styles: ["modern"] },
  { id: "plant-pilea", name: "Pilea Plant", category: "plant", dims: [40, 40, 55], price: 45, colors: ["sage", "ochre", "plaster"], styles: ["japandi"] },
  { id: "plant-palm", name: "Palm Plant", category: "plant", dims: [55, 55, 145], price: 95, colors: ["sage", "oak", "terracotta"], styles: ["coastal"] },
  { id: "plant-ivy", name: "Ivy Plant", category: "plant", dims: [40, 40, 70], price: 35, colors: ["sage", "plum", "plaster"], styles: ["rustic", "scandinavian"] },

  { id: "decor-bowl", name: "Kyst Bowl Decor", category: "decor", dims: [28, 28, 12], price: 45, colors: ["oak", "plaster", "sage"], styles: ["scandinavian", "coastal"] },
  { id: "decor-vase", name: "Mira Vase Decor", category: "decor", dims: [22, 22, 34], price: 55, colors: ["terracotta", "plum", "plaster"], styles: ["modern"] },
  { id: "decor-tray", name: "Lin Tray Decor", category: "decor", dims: [36, 24, 5], price: 35, colors: ["oak", "charcoal"], styles: ["japandi"] },
  { id: "decor-sculpture", name: "Ro Sculpture Decor", category: "decor", dims: [25, 20, 42], price: 120, colors: ["plaster", "ochre", "charcoal"], styles: ["mid-century"] },
  { id: "decor-basket", name: "Ull Basket Decor", category: "decor", dims: [40, 40, 45], price: 65, colors: ["oak", "terracotta", "sage"], styles: ["rustic", "scandinavian"] },
];

function makeItem(spec: Spec): CatalogItem {
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    dims: { w: spec.dims[0], d: spec.dims[1], h: spec.dims[2] },
    clearanceFront: clearance[spec.category],
    ...(spec.seats === undefined ? {} : { seatCount: spec.seats }),
    glb: `/assets/glb/${spec.id}.glb`,
    colorways: spec.colors.map((id) => ({ id, ...colorways[id] })),
    styleTags: [...spec.styles],
    price: spec.price,
    description: descriptions[spec.category],
    ...(wallCategories.has(spec.category) ? { againstWall: true } : {}),
  };
}

/** Built-in deterministic catalog used before a Shopify snapshot is available. */
export const catalogSource: CatalogItem[] = specs.map(makeItem);
