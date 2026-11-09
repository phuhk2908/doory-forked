import { colorCollaborators } from "./collaboratorColors";

describe("collaborator colors", () => {
  it("keeps active collaborators distinct and stable when their order changes", () => {
    const remembered = new Map<string, string>();
    const first = colorCollaborators(["ada", "bo", "cy"], remembered);
    const reordered = colorCollaborators(["cy", "ada", "bo"], remembered);

    expect(new Set(reordered.values()).size).toBe(3);
    expect(reordered.get("ada")).toBe(first.get("ada"));
    expect(reordered.get("bo")).toBe(first.get("bo"));
    expect(reordered.get("cy")).toBe(first.get("cy"));
  });

  it("continues with unique fallback colors beyond the palette", () => {
    const remembered = new Map<string, string>();
    const colors = colorCollaborators(
      Array.from({ length: 10 }, (_, index) => "peer-" + index),
      remembered,
    );

    expect(new Set(colors.values()).size).toBe(10);
  });
});
