import { DrawingHistory } from "./history";
import { blankDrawing, createElement } from "./model";

describe("drawing history", () => {
  it("undoes and redoes snapshots while discarding a redo branch", () => {
    const initial = blankDrawing();
    const history = new DrawingHistory(initial);
    const first = { ...initial, elements: [createElement("rectangle")] };
    const second = {
      ...first,
      elements: [...first.elements, createElement("ellipse")],
    };
    history.push(first, "Add rectangle");
    history.push(second, "Add ellipse");
    expect(history.undo()).toEqual(first);
    expect(history.redo()).toEqual(second);
    expect(history.undo()).toEqual(first);
    history.push(initial, "Clear");
    expect(history.canRedo).toBe(false);
  });
});
