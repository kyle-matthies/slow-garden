/**
 * Seed packs: named sets of starting topics for a new garden. Each topic comes
 * with one opening question, which may become a thought's title. A pack never
 * supplies body text: the page stays the person's own words.
 *
 * Tone: plain and curious. No clinical or mood language, no advice, and
 * nothing that promises an outcome. seed-pack-data.test.ts guards this.
 */
export type SeedPackTopic = {
  /** Becomes a topic (a bed). */
  name: string;
  /** One gentle opening question; offered as a thought title, never as writing. */
  question: string;
};

export type SeedPack = {
  id: string;
  name: string;
  /** A short line on the packet, like the note on the back of a real one. */
  note: string;
  /** Packet paper tint; see seed-pack.css. */
  tone: "sage" | "clay" | "slate" | "plum" | "fern" | "rose" | "stone" | "teal";
  /** Seeds the packet's drawing so each pack keeps its own plant. */
  plant: string;
  topics: readonly SeedPackTopic[];
};

export const SEED_PACKS: readonly SeedPack[] = [
  {
    id: "decision",
    name: "A decision I’m circling",
    note: "For something you haven’t settled.",
    tone: "slate",
    plant: "seed-pack-decision-8",
    topics: [
      { name: "The question itself", question: "What is the decision, in one plain sentence?" },
      { name: "What I’m afraid of", question: "What would it look like if this went wrong?" },
      { name: "What I’d tell a friend", question: "If a friend brought you this, what would you say?" },
    ],
  },
  {
    id: "work",
    name: "Work in progress",
    note: "For whatever is on the bench.",
    tone: "clay",
    plant: "seed-pack-work-28",
    topics: [
      { name: "In the middle of", question: "What are you in the middle of right now?" },
      { name: "Where it stopped", question: "Where did it stop moving, and what was the last thing you tried?" },
      { name: "Loose ends", question: "What have you been meaning to get back to?" },
      { name: "Learned the hard way", question: "What do you know now that you didn’t a month ago?" },
    ],
  },
  {
    id: "reading",
    name: "What I’m reading",
    note: "For books, articles, anything read.",
    tone: "plum",
    plant: "seed-pack-reading-3",
    topics: [
      { name: "On the nightstand", question: "What are you reading, and why this one?" },
      { name: "Lines worth keeping", question: "Which sentence did you read twice?" },
      { name: "Arguments with the author", question: "Where did you find yourself disagreeing?" },
      { name: "To read next", question: "What’s on the pile, and who put it there?" },
    ],
  },
  {
    id: "mornings",
    name: "Mornings",
    note: "For a few lines before the day.",
    tone: "sage",
    plant: "seed-pack-mornings-3",
    topics: [
      { name: "Before the day starts", question: "What’s on your mind before anything has happened?" },
      { name: "Still here from yesterday", question: "What from yesterday is still with you?" },
      { name: "Today’s one thing", question: "What would you like to give your attention to today?" },
    ],
  },
  {
    id: "making",
    name: "Making things",
    note: "For a craft, a practice, a project.",
    tone: "fern",
    plant: "seed-pack-making-13",
    topics: [
      { name: "On the table", question: "What are you making, and what stage is it at?" },
      { name: "Things I tried", question: "What did you try this week that you hadn’t before?" },
      { name: "Not yet started", question: "What do you keep wanting to make?" },
      { name: "After finishing", question: "What did the last finished thing show you?" },
    ],
  },
  {
    id: "people",
    name: "People",
    note: "For the ones you think about.",
    tone: "rose",
    plant: "seed-pack-people-6",
    topics: [
      { name: "Conversations", question: "What did someone say that you keep turning over?" },
      { name: "Things I meant to say", question: "What did you leave unsaid, and to whom?" },
      { name: "People I’m learning from", question: "Who are you watching closely, and what for?" },
    ],
  },
  {
    id: "places",
    name: "Places",
    note: "For where you are and where you go.",
    tone: "teal",
    plant: "seed-pack-places-6",
    topics: [
      { name: "Close to home", question: "What have you noticed on your street lately?" },
      { name: "Walks", question: "Where did you walk, and what was there?" },
      { name: "Places I go back to", question: "Where do you keep returning, and what’s there for you?" },
    ],
  },
  {
    id: "questions",
    name: "Questions I keep asking",
    note: "For what you haven’t worked out.",
    tone: "stone",
    plant: "seed-pack-questions-1",
    topics: [
      { name: "Open questions", question: "What question keeps coming back?" },
      { name: "Changed my mind", question: "What did you used to think, and what moved you?" },
      { name: "Don’t understand yet", question: "What would you like someone to explain to you?" },
    ],
  },
];

export const bedKeyFor = (packId: string, index: number) => `${packId}/${index}`;

/** The catalog entry behind a bed key, if the catalog still has it. */
export function seedTopicFor(key: string): { pack: SeedPack; topic: SeedPackTopic } | null {
  const [packId, index] = key.split("/");
  const pack = SEED_PACKS.find((p) => p.id === packId);
  const topic = pack?.topics[Number(index)];
  return pack && topic ? { pack, topic } : null;
}
