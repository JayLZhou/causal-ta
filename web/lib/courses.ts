import c0 from "./coursepacks/binary-search-progress.json";
import c1 from "./coursepacks/conditional-probability.json";
import c2 from "./coursepacks/container-network.json";
import c3 from "./coursepacks/derivative-change.json";
import c4 from "./coursepacks/linear-functions.json";
import c5 from "./coursepacks/python-loop-boundaries.json";
export const courses: Record<string, any> = Object.fromEntries([c0,c1,c2,c3,c4,c5].map(c => [c.id,c]));
