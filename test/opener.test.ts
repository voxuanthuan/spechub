import { EventEmitter } from "node:events";
import open from "open";
import { openBrowser } from "../src/opener.js";

vi.mock("open", () => ({
  default: vi.fn(),
  apps: {
    chrome: "google-chrome"
  }
}));

describe("browser opener", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
  });

  test("opens dashboard with the default browser instead of forcing Chrome", async () => {
    const subprocess = new EventEmitter();
    vi.mocked(open).mockResolvedValue(subprocess as never);

    await openBrowser("http://127.0.0.1:1234");

    expect(open).toHaveBeenCalledWith("http://127.0.0.1:1234");
    expect(open).not.toHaveBeenCalledWith(
      "http://127.0.0.1:1234",
      expect.objectContaining({
        app: expect.anything()
      })
    );
  });

  test("handles opener spawn errors without throwing", async () => {
    const subprocess = new EventEmitter();
    vi.mocked(open).mockResolvedValue(subprocess as never);

    await openBrowser("http://127.0.0.1:1234");

    expect(subprocess.listenerCount("error")).toBeGreaterThan(0);
    expect(() => subprocess.emit("error", new Error("spawn xdg-open ENOENT"))).not.toThrow();
  });
});
