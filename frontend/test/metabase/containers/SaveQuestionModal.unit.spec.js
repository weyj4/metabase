import React from "react";
import userEvent from "@testing-library/user-event";
import nock from "nock";
import { act, renderWithProviders, screen, waitFor } from "__support__/ui";

import SaveQuestionModal from "metabase/containers/SaveQuestionModal";
import MetabaseSettings from "metabase/lib/settings";

import {
  SAMPLE_DATABASE,
  ORDERS,
  metadata,
} from "__support__/sample_database_fixture";
import { setupEnterpriseTest } from "__support__/enterprise";
import Question from "metabase-lib/Question";

function mockCachingEnabled(enabled = true) {
  const original = MetabaseSettings.get.bind(MetabaseSettings);
  const spy = jest.spyOn(MetabaseSettings, "get");
  spy.mockImplementation(key => {
    if (key === "enable-query-caching") {
      return enabled;
    }
    if (key === "application-name") {
      return "Metabase Test";
    }
    if (key === "version") {
      return { tag: "" };
    }
    if (key === "is-hosted?") {
      return false;
    }
    if (key === "enable-enhancements?") {
      return false;
    }
    return original(key);
  });
}

const setup = async (question, originalQuestion) => {
  const onCreateMock = jest.fn(() => Promise.resolve());
  const onSaveMock = jest.fn(() => Promise.resolve());
  const onCloseMock = jest.fn();
  renderWithProviders(
    <SaveQuestionModal
      card={question.card()}
      originalCard={originalQuestion && originalQuestion.card()}
      tableMetadata={question.table()}
      onCreate={onCreateMock}
      onSave={onSaveMock}
      onClose={onCloseMock}
    />,
  );
  await waitFor(() => screen.getByRole("button", { name: "Save" }));
  return { onSaveMock, onCreateMock, onCloseMock };
};

const EXPECTED_SUGGESTED_NAME = "Orders, Count";

function getQuestion({
  isSaved,
  name = "Q1",
  description = "Example",
  collection_id = null,
  can_write = true,
} = {}) {
  const extraCardParams = {};

  if (isSaved) {
    extraCardParams.id = 1; // if a card has an id, it means it's saved
    extraCardParams.name = name;
    extraCardParams.description = description;
    extraCardParams.collection_id = collection_id;
    extraCardParams.can_write = can_write;
  }

  return new Question(
    {
      ...extraCardParams,
      display: "table",
      visualization_settings: {},
      dataset_query: {
        type: "query",
        database: SAMPLE_DATABASE.id,
        query: {
          "source-table": ORDERS.id,
          aggregation: [["count"]],
        },
      },
    },
    metadata,
  );
}

const EXPECTED_DIRTY_SUGGESTED_NAME = "Orders, Count, Grouped by Total";

function getDirtyQuestion(originalQuestion) {
  const question = originalQuestion
    .query()
    .breakout(["field", ORDERS.TOTAL.id, null])
    .question();
  return question.setCard({
    ...question.card(),
    // After a saved question is edited, the ID gets removed
    // and a user can either overwrite a question or save it as a new one
    id: undefined,
  });
}

async function fillForm({ name, description }) {
  if (name) {
    const input = screen.getByLabelText("Name");
    await userEvent.clear(input);
    await userEvent.type(input, name);
  }
  if (description) {
    const input = screen.getByLabelText("Description");
    await userEvent.clear(input);
    await userEvent.type(input, description);
  }
}

describe("SaveQuestionModal", () => {
  beforeAll(() => {
    console.error = jest.fn();
    console.warn = jest.fn();
  });

  const TEST_COLLECTIONS = [
    {
      can_write: false,
      effective_ancestors: [],
      effective_location: null,
      id: "root",
      name: "Our analytics",
      parent_id: null,
    },
    {
      archived: false,
      can_write: true,
      color: "#31698A",
      description: null,
      id: 1,
      location: "/",
      name: "Bobby Tables's Personal Collection",
      namespace: null,
      personal_owner_id: 1,
      slug: "bobby_tables_s_personal_collection",
    },
  ];

  beforeEach(() => {
    nock(location.origin).get("/api/collection").reply(200, TEST_COLLECTIONS);
    nock(location.origin)
      .get("/api/collection/root")
      .reply(200, TEST_COLLECTIONS);
  });

  afterEach(() => {
    nock.cleanAll();
  });

  describe("new question", () => {
    it("should suggest a name for structured queries", async () => {
      await setup(getQuestion());
      expect(screen.getByLabelText("Name")).toHaveValue(
        EXPECTED_SUGGESTED_NAME,
      );
    });

    it("should not suggest a name for native queries", async () => {
      await setup(
        new Question(
          {
            dataset_query: {
              type: "native",
              database: ORDERS.id,
              native: {
                query: "select * from orders",
              },
              display: "table",
            },
          },
          metadata,
        ),
      );

      expect(screen.getByLabelText("Name")).toHaveValue("");
    });

    it("should display empty description input", async () => {
      await setup(getQuestion());
      expect(screen.getByLabelText("Description")).toHaveValue("");
    });

    it("should call onCreate correctly with default form values", async () => {
      const question = getQuestion();
      const { onCreateMock } = await setup(question);

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onCreateMock).toHaveBeenCalledTimes(1);
      expect(onCreateMock).toHaveBeenCalledWith({
        ...question.card(),
        name: EXPECTED_SUGGESTED_NAME,
        description: null,
        collection_id: null,
      });
    });

    it("should call onCreate correctly with edited form", async () => {
      const question = getQuestion();
      const { onCreateMock } = await setup(question);

      await act(async () => {
        await fillForm({
          name: "My favorite orders",
          description: "So many of them",
        });
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onCreateMock).toHaveBeenCalledTimes(1);
      expect(onCreateMock).toHaveBeenCalledWith({
        ...question.card(),
        name: "My favorite orders",
        description: "So many of them",
        collection_id: null,
      });
    });

    it("should trim name and description", async () => {
      const question = getQuestion();
      const { onCreateMock } = await setup(question);

      await act(async () => {
        await fillForm({
          name: "    My favorite orders ",
          description: "  So many of them   ",
        });
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onCreateMock).toHaveBeenCalledTimes(1);
      expect(onCreateMock).toHaveBeenCalledWith({
        ...question.card(),
        name: "My favorite orders",
        description: "So many of them",
        collection_id: null,
      });
    });

    it('should correctly handle saving a question in the "root" collection', async () => {
      const question = getQuestion({
        collection_id: "root",
      });
      const { onCreateMock } = await setup(question);

      await act(async () => {
        await fillForm({ name: "foo", description: "bar" });
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onCreateMock).toHaveBeenCalledTimes(1);
      expect(onCreateMock).toHaveBeenCalledWith({
        ...question.card(),
        name: "foo",
        description: "bar",
        collection_id: null,
      });
    });

    it("shouldn't call onSave when form is submitted", async () => {
      const question = getQuestion();
      const { onSaveMock } = await setup(question);

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onSaveMock).not.toHaveBeenCalled();
    });

    it("shouldn't show a control to overwrite a saved question", async () => {
      await setup(getQuestion());
      expect(
        screen.queryByText("Save as new question"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Replace original question, ".*"/),
      ).not.toBeInTheDocument();
    });
  });

  describe("saving as a new question", () => {
    it("should offer to replace the original question by default", async () => {
      const originalQuestion = getQuestion({ isSaved: true });
      await setup(getDirtyQuestion(originalQuestion), originalQuestion);

      expect(
        screen.getByLabelText(/Replace original question, ".*"/),
      ).toBeChecked();
      expect(screen.getByText("Save as new question")).not.toBeChecked();
    });

    it("should switch to the new question form", async () => {
      const CARD = {
        name: "Q1",
        description: "Example description",
        collection_id: null,
      };
      const originalQuestion = getQuestion({ isSaved: true, ...CARD });
      const dirtyQuestion = getDirtyQuestion(originalQuestion);
      await setup(dirtyQuestion, originalQuestion);

      await act(async () => {
        await userEvent.click(screen.getByText("Save as new question"));
      });

      expect(screen.getByLabelText("Name")).toHaveValue(
        EXPECTED_DIRTY_SUGGESTED_NAME,
      );
      expect(screen.getByLabelText("Description")).toHaveValue(
        CARD.description,
      );
      expect(screen.queryByText("Our analytics")).toBeInTheDocument();
    });

    // one
    it("should allow to save a question with default form values", async () => {
      const originalQuestion = getQuestion({ isSaved: true });
      const dirtyQuestion = getDirtyQuestion(originalQuestion);
      const { onCreateMock } = await setup(dirtyQuestion, originalQuestion);

      await act(async () => {
        await userEvent.click(screen.getByText("Save as new question"));
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onCreateMock).toHaveBeenCalledTimes(1);
      expect(onCreateMock).toHaveBeenCalledWith({
        ...dirtyQuestion.card(),
        name: EXPECTED_DIRTY_SUGGESTED_NAME,
      });
    });

    it("show allow to save a question with an edited form", async () => {
      const originalQuestion = getQuestion({ isSaved: true });
      const dirtyQuestion = getDirtyQuestion(originalQuestion);
      const { onCreateMock } = await setup(dirtyQuestion, originalQuestion);

      await act(async () => {
        await userEvent.click(screen.getByText("Save as new question"));
        await fillForm({ name: "My Q", description: "Sample" });
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onCreateMock).toHaveBeenCalledTimes(1);
      expect(onCreateMock).toHaveBeenCalledWith({
        ...dirtyQuestion.card(),
        name: "My Q",
        description: "Sample",
      });
    });

    it("shouldn't allow to save a question if form is invalid", async () => {
      const originalQuestion = getQuestion({ isSaved: true });
      await setup(getDirtyQuestion(originalQuestion), originalQuestion);

      await act(async () => {
        await userEvent.click(screen.getByText("Save as new question"));
        await userEvent.clear(screen.getByLabelText("Name"));
        await userEvent.clear(screen.getByLabelText("Description"));
      });

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
  });

  describe("overwriting a saved question", () => {
    it("should display original question's name on save mode control", async () => {
      const originalQuestion = getQuestion({
        isSaved: true,
        name: "Beautiful Orders",
      });
      const dirtyQuestion = getDirtyQuestion(originalQuestion);
      await setup(dirtyQuestion, originalQuestion);

      expect(
        screen.queryByText('Replace original question, "Beautiful Orders"'),
      ).toBeInTheDocument();
    });

    it("should call onSave correctly when form is submitted", async () => {
      const originalQuestion = getQuestion({ isSaved: true });
      const dirtyQuestion = getDirtyQuestion(originalQuestion);
      const { onSaveMock } = await setup(dirtyQuestion, originalQuestion);

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onSaveMock).toHaveBeenCalledTimes(1);
      expect(onSaveMock).toHaveBeenCalledWith({
        ...dirtyQuestion.card(),
        id: originalQuestion.id(),
      });
    });

    it("should allow switching to 'save as new' and back", async () => {
      const originalQuestion = getQuestion({ isSaved: true });
      const dirtyQuestion = getDirtyQuestion(originalQuestion);
      const { onSaveMock } = await setup(dirtyQuestion, originalQuestion);

      await act(async () => {
        await userEvent.click(screen.getByText("Save as new question"));
        await userEvent.click(
          screen.getByText(/Replace original question, ".*"/),
        );
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onSaveMock).toHaveBeenCalledTimes(1);
      expect(onSaveMock).toHaveBeenCalledWith({
        ...dirtyQuestion.card(),
        id: originalQuestion.id(),
      });
    });

    it("should preserve original question's collection id", async () => {
      const originalQuestion = getQuestion({
        isSaved: true,
        collection_id: 5,
      });
      const { onSaveMock } = await setup(
        getDirtyQuestion(originalQuestion),
        originalQuestion,
      );

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onSaveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          collection_id: originalQuestion.collectionId(),
        }),
      );
    });

    it("shouldn't allow to save a question if form is invalid", async () => {
      await setup(getQuestion());

      await act(async () => {
        await userEvent.clear(screen.getByLabelText("Name"));
        await userEvent.clear(screen.getByLabelText("Description"));
      });

      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });

    it("shouldn't call onCreate when form is submitted", async () => {
      const originalQuestion = getQuestion({ isSaved: true });
      const dirtyQuestion = getDirtyQuestion(originalQuestion);
      const { onCreateMock } = await setup(dirtyQuestion, originalQuestion);

      await act(async () => {
        await userEvent.click(screen.getByRole("button", { name: "Save" }));
      });

      expect(onCreateMock).not.toHaveBeenCalled();
    });

    it("should keep 'save as new' form values while switching saving modes", async () => {
      const originalQuestion = getQuestion({ isSaved: true });
      await setup(getDirtyQuestion(originalQuestion), originalQuestion);

      await act(async () => {
        await userEvent.click(screen.getByText("Save as new question"));
        await fillForm({
          name: "Should not be erased",
          description: "This should not be erased too",
        });
        await userEvent.click(
          screen.getByText(/Replace original question, ".*"/),
        );
        await userEvent.click(screen.getByText("Save as new question"));
      });

      expect(screen.getByLabelText("Name")).toHaveValue("Should not be erased");
      expect(screen.getByLabelText("Description")).toHaveValue(
        "This should not be erased too",
      );
    });

    it("should allow to replace the question if new question form is invalid (metabase#13817)", async () => {
      const originalQuestion = getQuestion({ isSaved: true });
      await setup(getDirtyQuestion(originalQuestion), originalQuestion);

      await act(async () => {
        await userEvent.click(screen.getByText("Save as new question"));
        await userEvent.clear(screen.getByLabelText("Name"));
        await userEvent.click(
          screen.getByText(/Replace original question, ".*"/),
        );
      });

      expect(await screen.getByRole("button", { name: "Save" })).toBeEnabled();
    });

    it("should not allow overwriting when user does not have curate permission on collection (metabase#20717)", async () => {
      const originalQuestion = getQuestion({
        isSaved: true,
        name: "Beautiful Orders",
        can_write: false,
      });
      const dirtyQuestion = getDirtyQuestion(originalQuestion);
      await setup(dirtyQuestion, originalQuestion);

      expect(
        screen.queryByText("Save as new question"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Replace original question, ".*"/),
      ).not.toBeInTheDocument();
    });
  });

  it("should call onClose when Cancel button is clicked", async () => {
    const { onCloseMock } = await setup(getQuestion());
    await act(async () => {
      userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  it("should call onClose when close icon is clicked", async () => {
    const { onCloseMock } = await setup(getQuestion());
    await act(async () => {
      userEvent.click(screen.getByLabelText("close icon"));
    });
    expect(onCloseMock).toHaveBeenCalledTimes(1);
  });

  describe("Cache TTL field", () => {
    beforeEach(() => {
      mockCachingEnabled();
    });

    const question = Question.create({
      databaseId: SAMPLE_DATABASE.id,
      tableId: ORDERS.id,
      metadata,
    })
      .query()
      .aggregate(["count"])
      .question();

    describe("OSS", () => {
      it("is not shown", async () => {
        await setup(question);
        expect(screen.queryByText("More options")).not.toBeInTheDocument();
        expect(
          screen.queryByText("Cache all question results for"),
        ).not.toBeInTheDocument();
      });
    });

    describe("EE", () => {
      beforeEach(() => {
        setupEnterpriseTest();
      });

      it("is not shown", async () => {
        await setup(question);
        expect(screen.queryByText("More options")).not.toBeInTheDocument();
        expect(
          screen.queryByText("Cache all question results for"),
        ).not.toBeInTheDocument();
      });
    });
  });
});
