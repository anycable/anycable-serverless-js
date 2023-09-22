import { Application } from "@/application";
import { test } from "uvu";
import * as assert from "uvu/assert";

test("application is created", () => {
  const app = new Application();

  assert.ok(app);
});

test.run();
