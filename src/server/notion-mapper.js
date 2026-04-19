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
const url = (value) => ({ url: value || null });
const number = (value) => ({ number: Number.isFinite(Number(value)) ? Number(value) : 0 });
const date = (value) => ({ date: value ? { start: value } : null });
const files = (value, name = 'Recipe photo') => {
  const cleanValue = String(value || '').trim();
  if (!cleanValue) return { files: [] };
  return {
    files: [
      {
        name,
        external: {
          url: cleanValue,
        },
      },
    ],
  };
};

const readFiles = (value = {}) => {
  const firstFile = Array.isArray(value?.files) ? value.files[0] : null;
  if (!firstFile) return '';
  if (firstFile.type === 'external') return firstFile.external?.url || '';
  if (firstFile.type === 'file') return firstFile.file?.url || '';
  if (firstFile.type === 'file_upload') return firstFile.file_upload?.url || '';
  return '';
};

export const recipeToNotionProperties = (recipe) => ({
  'App ID': richText(recipe.id),
  'Recipe Name': title(recipe.name),
  Cuisine: richText(recipe.cuisine),
  Source: richText(recipe.source),
  Location: richText(recipe.location),
  'Prep Time': richText(recipe.preptime),
  'Cook Time': richText(recipe.cooktime),
  Servings: richText(recipe.servings),
  Tags: richText(recipe.tags),
  'Source URL': url(recipe.url),
  Photos: files(recipe.image, recipe.name || 'Recipe photo'),
  'Date Tried': date(recipe.date),
  Rating: number(recipe.rating),
  Notes: richText(recipe.notes),
  Ingredients: richText(recipe.ingredients),
  Steps: richText(recipe.instructions),
  Version: number(recipe.version || 1),
  'Last Synced At': date(new Date().toISOString()),
});

export const notionPageToRecipe = (page) => {
  const props = page?.properties || {};
  return {
    id: joinText(props['App ID']?.rich_text),
    notionPageId: page.id,
    name: joinText(props['Recipe Name']?.title),
    cuisine: joinText(props.Cuisine?.rich_text || props.Cuisine?.text),
    source: joinText(props.Source?.rich_text),
    location: joinText(props.Location?.rich_text),
    preptime: joinText(props['Prep Time']?.rich_text),
    cooktime: joinText(props['Cook Time']?.rich_text),
    servings: joinText(props.Servings?.rich_text),
    tags: joinText(props.Tags?.rich_text),
    url: props['Source URL']?.url || '',
    image: readFiles(props.Photos),
    date: props['Date Tried']?.date?.start || '',
    rating: Number(props.Rating?.number || 0),
    notes: joinText(props.Notes?.rich_text),
    ingredients: joinText(props.Ingredients?.rich_text),
    instructions: joinText(props.Steps?.rich_text),
    version: Number(props.Version?.number || 1),
  };
};

export const appIdFilter = (id) => ({
  property: 'App ID',
  rich_text: { equals: id },
});

export const activeRecipesFilter = null;
