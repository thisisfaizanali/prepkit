import { describe, expect, it } from "vitest";
import { setupBuilder } from "./testApp.ts";

describe("POST /api/kits/:id/practice", () => {
  it("records a rating, increments reviews, and shows up in GET kit", async () => {
    const { a, id, kit } = await setupBuilder();
    const cardId = (await kit()).kit.flashcards[0].id;
    const first = await a.post(`/api/kits/${id}/practice`).send({ flashcardId: cardId, confidence: 1 }).expect(200);
    expect(first.body).toMatchObject({ confidence: 1, reviews: 1 });
    const second = await a.post(`/api/kits/${id}/practice`).send({ flashcardId: cardId, confidence: 3 }).expect(200);
    expect(second.body).toMatchObject({ confidence: 3, reviews: 2 });
    const got = (await a.get(`/api/kits/${id}`).expect(200)).body;
    expect(got.practice[cardId]).toEqual(second.body);
    expect(got.version).toBe(1); // ratings never touch the kit version
  });

  it("unknown card → 404, other user → 404, bad confidence → 400", async () => {
    const { a, id, kit, user } = await setupBuilder();
    await a.post(`/api/kits/${id}/practice`).send({ flashcardId: "nope", confidence: 2 }).expect(404);
    await a.post(`/api/kits/${id}/practice`).send({ flashcardId: "a.b", confidence: 2 }).expect(400);
    const cardId = (await kit()).kit.flashcards[0].id;
    await a.post(`/api/kits/${id}/practice`).send({ flashcardId: cardId, confidence: 4 }).expect(400);
    const b = await user("b@x.test");
    await b.post(`/api/kits/${id}/practice`).send({ flashcardId: cardId, confidence: 2 }).expect(404);
    expect((await kit()) as unknown as { practice: object }).toMatchObject({ practice: {} });
  });
});

describe("POST /api/kits/:id/schedule-progress", () => {
  it("marks and unmarks a day; rebuilding the schedule clears it; other user and unknown day → 404", async () => {
    const { a, id, user } = await setupBuilder();
    const marked = await a.post(`/api/kits/${id}/schedule-progress`).send({ day: 1, done: true }).expect(200);
    expect(Object.keys(marked.body.schedule_progress)).toEqual(["1"]);
    await a.post(`/api/kits/${id}/schedule-progress`).send({ day: 90, done: true }).expect(404);
    await (await user("b@x.test")).post(`/api/kits/${id}/schedule-progress`).send({ day: 1, done: true }).expect(404);
    const unmarked = await a.post(`/api/kits/${id}/schedule-progress`).send({ day: 1, done: false }).expect(200);
    expect(unmarked.body.schedule_progress).toEqual({});

    await a.post(`/api/kits/${id}/schedule-progress`).send({ day: 1, done: true }).expect(200);
    await a.post(`/api/kits/${id}/regenerate`).send({ section: "schedule" }).expect(200);
    expect((await a.get(`/api/kits/${id}`).expect(200)).body.schedule_progress).toEqual({});
  });
});
