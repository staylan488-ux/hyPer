import type { Food } from '@/types';

interface UsdaNutrient {
  nutrientName?: string;
  value?: number;
}

interface UsdaFood {
  fdcId?: number;
  description?: string;
  lowercaseDescription?: string;
  foodNutrients?: UsdaNutrient[];
}

interface UsdaSearchResponse {
  foods?: UsdaFood[];
}

function mapUsdaFood(food: UsdaFood): Food {
  const nutrients = food.foodNutrients || [];
  const getNutrient = (name: string) => {
    const nutrient = nutrients.find((item) =>
      item.nutrientName?.toLowerCase().includes(name.toLowerCase())
    );
    return nutrient?.value || 0;
  };

  return {
    id: food.fdcId?.toString() || '',
    user_id: null,
    name: food.description || food.lowercaseDescription || 'Unknown food',
    calories: getNutrient('energy'),
    protein: getNutrient('protein'),
    carbs: getNutrient('carbohydrate'),
    fat: getNutrient('total lipid (fat)'),
    serving_size: 100,
    serving_unit: 'g',
    source: 'usda',
    fdc_id: food.fdcId?.toString() || null,
  };
}

export async function searchUsdaFoods(
  query: string,
  apiKey: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<Food[]> {
  if (!query.trim() || !apiKey) return [];

  try {
    const response = await fetcher(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&pageSize=10&dataType=Foundation,SR Legacy,Branded`
    );
    const data = (await response.json()) as UsdaSearchResponse;

    if (!data.foods || data.foods.length === 0) {
      return [];
    }

    return data.foods.map(mapUsdaFood);
  } catch (error) {
    console.error('USDA search error:', error);
    return [];
  }
}
