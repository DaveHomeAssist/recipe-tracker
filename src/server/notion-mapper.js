const textChunks = (value, maxChunkLength = 2000) => {
  const input = String(value ?? '');
  if (!input) return [];

  const chunks = [];
  for (let i = 0; i < input.length; i += maxChunkLength) {
    chunks.push(input.slice(i, i + maxChunkLength));
  }
  return chunks.slice(0, 50).map((content) => ({
    type: 'text',
    text: { content },
  }));
};

const joinText = (items = []) =>
  items
    .map((item) => item?.plain_text || item?.text?.content || '')
    .join('');

const richText = (value) => ({ rich_text: textChunks(value) });
const title = (value) => ({ title: textChunks(value) });

const select = (value) => ({ select: value ? { name: String(value) } : null });
const url = (value) => ({ url: value || null });
const number = (value) => ({ number: Number.isFinite(Number(value)) ? Number(value) : 0 });
const checkbox = (value) => ({ checkbox: Boolean(value) });
const date = (value) => ({ date: value ? { start: value } : null });

export const recipeToNotionProperties = (recipe) => ({
  'App ID': richText(recipe.id),
  Name: title(recipe.name),
  Cuisine: select(recipe.cuisine),
  Source: richText(recipe.source),
  Location: richText(recipe.location),
  'Prep Time': richText(recipe.preptime),
  'Cook Time': richText(recipe.cooktime),
  Servings: richText(recipe.servings),
  Tags: richText(recipe.tags),
  'Source URL': url(recipe.url),
  'Image URL': url(recipe.image),
  'Date Tried': date(recipe.date),
  Rating: number(recipe.rating),
  Notes: richText(recipe.notes),
  Ingredients: richText(recipe.ingredients),
  Instructions: richText(recipe.instructions),
  Version: number(recipe.version || 1),
  Deleted: checkbox(Boolean(recipe.deleted)),
  'Last Synced At': date(new Date().toISOString()),
});

export const notionPageToRecipe = (page) => {
  const props = page?.properties || {};
  return {
    id: joinText(props['App ID']?.rich_text),
    notionPageId: page.id,
    name: joinText(props.Name?.title),
    cuisine: props.Cuisine?.select?.name || '',
    source: joinText(props.Source?.rich_text),
    location: joinText(props.Location?.rich_text),
    preptime: joinText(props['Prep Time']?.rich_text),
    cooktime: joinText(props['Cook Time']?.rich_text),
    servings: joinText(props.Servings?.rich_text),
    tags: joinText(props.Tags?.rich_text),
    url: props['Source URL']?.url || '',
    image: props['Image URL']?.url || '',
    date: props['Date Tried']?.date?.start || '',
    rating: Number(props.Rating?.number || 0),
    notes: joinText(props.Notes?.rich_text),
    ingredients: joinText(props.Ingredients?.rich_text),
    instructions: joinText(props.Instructions?.rich_text),
    version: Number(props.Version?.number || 1),
    deleted: Boolean(props.Deleted?.checkbox),
  };
};

export const appIdFilter = (id) => ({
  property: 'App ID',
  rich_text: { equals: id },
});

export const activeRecipesFilter = {
  property: 'Deleted',
  checkbox: { equals: false },
};
