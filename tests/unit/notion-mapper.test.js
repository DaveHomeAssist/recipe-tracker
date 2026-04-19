import { describe, expect, it } from 'vitest';

import { notionPageToRecipe, recipeToNotionProperties } from '../../src/server/notion-mapper.js';

describe('recipeToNotionProperties', () => {
  it('maps a recipe into the live DB | Recipes property payload', () => {
    const properties = recipeToNotionProperties({
      id: 'recipe_1',
      name: 'Cacio e Pepe',
      cuisine: 'Italian',
      image: 'https://example.com/image.jpg',
      tags: 'Quick, Pasta',
      rating: 4,
      instructions: 'Boil pasta',
    });

    expect(properties['App ID'].rich_text[0].text.content).toBe('recipe_1');
    expect(properties['Recipe Name'].title[0].text.content).toBe('Cacio e Pepe');
    expect(properties.Cuisine.rich_text[0].text.content).toBe('Italian');
    expect(properties.Photos.files[0].external.url).toBe('https://example.com/image.jpg');
    expect(properties.Steps.rich_text[0].text.content).toBe('Boil pasta');
    expect(properties.Rating.number).toBe(4);
  });

  it('chunks long rich text into multiple Notion objects', () => {
    const properties = recipeToNotionProperties({
      id: 'recipe_1',
      name: 'Soup',
      instructions: 'a'.repeat(2100),
      rating: 0,
    });

    expect(properties.Steps.rich_text).toHaveLength(2);
    expect(properties.Steps.rich_text[0].text.content.length).toBe(2000);
  });
});

describe('notionPageToRecipe', () => {
  it('maps Notion page properties back to the app shape', () => {
    const recipe = notionPageToRecipe({
      id: 'page_1',
      properties: {
        'App ID': { rich_text: [{ plain_text: 'recipe_1' }] },
        'Recipe Name': { title: [{ plain_text: 'Cacio e Pepe' }] },
        Cuisine: { rich_text: [{ plain_text: 'Italian' }] },
        Source: { rich_text: [{ plain_text: 'Trattoria' }] },
        Location: { rich_text: [{ plain_text: 'Rome' }] },
        'Prep Time': { rich_text: [{ plain_text: '10 min' }] },
        'Cook Time': { rich_text: [{ plain_text: '20 min' }] },
        Servings: { rich_text: [{ plain_text: '2' }] },
        Tags: { rich_text: [{ plain_text: 'Quick, Pasta' }] },
        'Source URL': { url: 'https://example.com' },
        Photos: {
          files: [
            {
              type: 'external',
              external: { url: 'https://example.com/image.jpg' },
            },
          ],
        },
        'Date Tried': { date: { start: '2026-04-16' } },
        Rating: { number: 5 },
        Notes: { rich_text: [{ plain_text: 'Family favorite' }] },
        Ingredients: { rich_text: [{ plain_text: 'pecorino' }] },
        Steps: { rich_text: [{ plain_text: 'mix' }] },
        Version: { number: 3 },
      },
    });

    expect(recipe).toMatchObject({
      id: 'recipe_1',
      notionPageId: 'page_1',
      name: 'Cacio e Pepe',
      cuisine: 'Italian',
      image: 'https://example.com/image.jpg',
      rating: 5,
      version: 3,
    });
  });
});
