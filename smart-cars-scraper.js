const https = require('https');
const { createClient } = require('@supabase/supabase-js');

// Supabase setup
const supabaseUrl = process.env.SUPABASE_URL || 'https://lmrxsurriyfhrzntljhk.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxtcnhzdXJyaXlmaHJ6bnRsamhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1NzM0MTAzNCwiZXhwIjoyMDcyOTE3MDM0fQ.DPdWeoyrPAfHiYUpjlY4Pq4yw1qeuOEkskE7K7Fkjc8';
const supabase = createClient(supabaseUrl, supabaseKey);

// Fetch page helper
async function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      let data = '';
      response.on('data', (chunk) => data += chunk);
      response.on('end', () => resolve(data));
    });
    request.on('error', reject);
    request.setTimeout(10000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

// Extract year from various date formats
function extractYear(rawDate) {
  if (!rawDate || typeof rawDate !== 'string') return new Date().getFullYear();
  
  const currentYear = new Date().getFullYear();
  const cleanDate = rawDate.replace(/[^\d\.\/\-\s]/g, '').trim();
  
  const patterns = [
    /(\d{2})\.(\d{4})/,  // MM.YYYY (most common format like "08.2013")
    /(\d{1,2})\/(\d{4})/, // M/YYYY or MM/YYYY  
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /(\d{4})/           // Just year (last to avoid false matches)
  ];
  
  for (const pattern of patterns) {
    const match = cleanDate.match(pattern);
    if (match) {
      let year;
      if (match.length === 3) {
        // MM.YYYY or M/YYYY format
        year = parseInt(match[2]);
      } else if (match.length === 4) {
        // YYYY-MM-DD format
        year = parseInt(match[1]);
      } else {
        // Just year
        year = parseInt(match[1]);
      }
      
      if (year >= 1990 && year <= currentYear + 1) {
        return year;
      }
    }
  }
  
  return currentYear;
}

// Extract price from various formats with HTML entity handling
function extractPrice(rawPrice) {
  if (!rawPrice || typeof rawPrice !== 'string') return 0;
  
  // First decode HTML entities
  let cleanPrice = rawPrice
    .replace(/&#x27;/g, "'")         // Decode &#x27; to apostrophe
    .replace(/&[a-zA-Z0-9#]+;/g, '') // Remove other HTML entities
    .replace(/[^\d\.\,\s']/g, '')    // Keep only digits, dots, commas, spaces, apostrophes
    .replace(/\s+/g, '');            // Remove spaces
  
  // Handle Swiss number formatting (15'555 -> 15555)
  if (cleanPrice.includes("'")) {
    cleanPrice = cleanPrice.replace(/'/g, '');
  }
  
  const priceMatch = cleanPrice.match(/(\d+)/);
  return priceMatch ? parseInt(priceMatch[1]) : 0;
}

// Extract mileage from various formats with HTML entity handling
function extractMileage(rawMileage) {
  if (!rawMileage || typeof rawMileage !== 'string') return 0;
  
  // First decode HTML entities
  let cleanMileage = rawMileage
    .replace(/&#x27;/g, "'")      // Decode &#x27; to apostrophe
    .replace(/&[a-zA-Z0-9#]+;/g, '') // Remove other HTML entities
    .replace(/[^\d\.\,\s']/g, '') // Keep only digits, dots, commas, spaces, apostrophes
    .replace(/\s+/g, '');         // Remove spaces
  
  // Handle Swiss number formatting (16'500 -> 16500)
  if (cleanMileage.includes("'")) {
    cleanMileage = cleanMileage.replace(/'/g, '');
  }
  
  const mileageMatch = cleanMileage.match(/(\d+)/);
  const mileage = mileageMatch ? parseInt(mileageMatch[1]) : 0;
  
  return (mileage >= 0 && mileage <= 999999) ? mileage : 0;
}

// Step 1: Get all available car brands from AutoScout24 (FULLY DYNAMIC like bikes)
async function getAllCarBrands() {
  console.log('🏷️ Getting all available car brands...');
  
  try {
    const html = await fetchPage('https://www.autoscout24.ch/de/hci/v2/5571/search');
    
    // Extract brand options from the makeKey select dropdown (same method as bikes)
    const brandSelectMatch = html.match(/<select[^>]*name=["']makeKey["'][^>]*>([\s\S]*?)<\/select>/);
    
    if (!brandSelectMatch) {
      console.log('❌ Could not find brand selector');
      return [];
    }
    
    const brandOptions = brandSelectMatch[1].match(/<option[^>]*value=["']([^"']+)["'][^>]*>([^<]+)<\/option>/g);
    
    if (!brandOptions) {
      console.log('❌ Could not find brand options');
      return [];
    }
    
    const brands = [];
    for (const option of brandOptions) {
      const match = option.match(/value=["']([^"']+)["'][^>]*>([^<]+)/);
      if (match && match[1] && match[2] && match[1] !== '') {
        brands.push({
          key: match[1].toLowerCase(),
          name: match[2].trim().toUpperCase()
        });
      }
    }
    
    console.log(`✅ Found ${brands.length} car brands:`, brands.map(b => b.name).join(', '));
    return brands;
    
  } catch (error) {
    console.error('❌ Error getting car brands:', error.message);
    return [];
  }
}

// Step 2: Get all models for a specific car brand
async function getModelsForCarBrand(brandKey, brandName) {
  console.log(`🏍️ Getting models for ${brandName}...`);
  
  try {
    const categories = [
      `https://www.autoscout24.ch/de/hci/v2/5571/search?makeKey=${brandKey}`, // Passenger cars
      `https://www.autoscout24.ch/de/hci/v2/5571/search?makeKey=${brandKey}&vehicleCategories=camper`, // Campers
      `https://www.autoscout24.ch/de/hci/v2/5571/search?makeKey=${brandKey}&vehicleCategories=utility` // Utility
    ];
    
    let allModels = new Set();
    
    for (const categoryUrl of categories) {
      const html = await fetchPage(categoryUrl);
      
      // Look for model dropdown options
      const modelMatches = html.match(/modelKey=([^&"]+).*?title="([^"]+)"/g);
      
      if (modelMatches) {
        modelMatches.forEach(match => {
          const keyMatch = match.match(/modelKey=([^&"]+)/);
          const titleMatch = match.match(/title="([^"]+)"/);
          
          if (keyMatch && titleMatch && keyMatch[1] !== '' && 
              titleMatch[1].trim().toLowerCase() !== 'alle' && 
              titleMatch[1].trim().toLowerCase() !== 'all') {
            allModels.add({
              key: keyMatch[1].toLowerCase(),
              name: titleMatch[1].trim()
            });
          }
        });
      }
    }
    
    const models = Array.from(allModels);
    
    if (models.length > 0) {
      const modelNames = models.map(m => m.name);
      console.log(`✅ Found ${models.length} models for ${brandName}:`, modelNames.join(', '));
    } else {
      console.log(`❌ No model options found for ${brandName}`);
    }
    
    return models;
    
  } catch (error) {
    console.error(`❌ Error getting models for ${brandName}:`, error.message);
    return [];
  }
}

// Step 3: Scrape vehicles for a specific brand-model combination
async function scrapeVehiclesForCarBrandModel(brandKey, brandName, modelName, modelKey) {
  console.log(`🔍 Scraping ${brandName} ${modelName}...`);
  
  const vehicles = [];
  let page = 1;
  let hasMorePages = true;
  
  const categories = [
    { name: 'passenger', url: `https://www.autoscout24.ch/de/hci/v2/5571/search?makeKey=${brandKey}&modelKey=${modelKey}` },
    { name: 'camper', url: `https://www.autoscout24.ch/de/hci/v2/5571/search?makeKey=${brandKey}&modelKey=${modelKey}&vehicleCategories=camper` },
    { name: 'utility', url: `https://www.autoscout24.ch/de/hci/v2/5571/search?makeKey=${brandKey}&modelKey=${modelKey}&vehicleCategories=utility` }
  ];
  
  for (const category of categories) {
    page = 1;
    hasMorePages = true;
    
    while (hasMorePages && page <= 5) { // Limit to 5 pages per category
      try {
        const pageUrl = page === 1 ? category.url : `${category.url}&page=${page}`;
        console.log(`📄 Scraping ${brandName} ${modelName} (${category.name}) page ${page}`);
        
        const html = await fetchPage(pageUrl);
        
        // Extract vehicle URLs from the page
        const urlMatches = html.match(/\/de\/hci\/v2\/5571\/detail\/\d+/g);
        
        if (urlMatches && urlMatches.length > 0) {
          for (const relativeUrl of urlMatches) {
            const fullUrl = `https://www.autoscout24.ch${relativeUrl}`;
            const vehicleDetail = await scrapeCarVehicleDetail(fullUrl, brandName, modelName);
            
            if (vehicleDetail) {
              // Set category to 'car' for all car types (passenger, camper, utility)
              vehicleDetail.category = 'car';
              
              vehicles.push(vehicleDetail);
              console.log(`✅ Scraped: ${vehicleDetail.title} - ${vehicleDetail.price} CHF`);
            }
            
            // Add delay between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          page++;
        } else {
          hasMorePages = false;
          console.log(`🏁 No more vehicles found for ${brandName} ${modelName} (${category.name})`);
        }
        
      } catch (error) {
        console.error(`❌ Error scraping ${brandName} ${modelName} page ${page}:`, error.message);
        hasMorePages = false;
      }
    }
  }
  
  return vehicles;
}

// Step 4: Scrape vehicles for a brand without specific models
async function scrapeVehiclesForCarBrand(brandKey, brandName) {
  console.log(`🔍 Scraping all ${brandName} vehicles...`);
  
  const vehicles = [];
  let page = 1;
  let hasMorePages = true;
  
  const categories = [
    { name: 'passenger', url: `https://www.autoscout24.ch/de/hci/v2/5571/search?makeKey=${brandKey}` },
    { name: 'camper', url: `https://www.autoscout24.ch/de/hci/v2/5571/search?makeKey=${brandKey}&vehicleCategories=camper` },
    { name: 'utility', url: `https://www.autoscout24.ch/de/hci/v2/5571/search?makeKey=${brandKey}&vehicleCategories=utility` }
  ];
  
  for (const category of categories) {
    page = 1;
    hasMorePages = true;
    
    while (hasMorePages && page <= 5) { // Limit to 5 pages per category
      try {
        const pageUrl = page === 1 ? category.url : `${category.url}&page=${page}`;
        console.log(`📄 Scraping ${brandName} (${category.name}) page ${page}`);
        
        const html = await fetchPage(pageUrl);
        
        // Extract vehicle URLs from the page
        const urlMatches = html.match(/\/de\/hci\/v2\/5571\/detail\/\d+/g);
        
        if (urlMatches && urlMatches.length > 0) {
          for (const relativeUrl of urlMatches) {
            const fullUrl = `https://www.autoscout24.ch${relativeUrl}`;
            const vehicleDetail = await scrapeCarVehicleDetail(fullUrl, brandName, null);
            
            if (vehicleDetail) {
              // Set category to 'car' for all car types (passenger, camper, utility)
              vehicleDetail.category = 'car';
              
              vehicles.push(vehicleDetail);
              console.log(`✅ Scraped: ${vehicleDetail.title} - ${vehicleDetail.price} CHF`);
            }
            
            // Add delay between requests
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          page++;
        } else {
          hasMorePages = false;
          console.log(`🏁 No more vehicles found for ${brandName} (${category.name})`);
        }
        
      } catch (error) {
        console.error(`❌ Error scraping ${brandName} page ${page}:`, error.message);
        hasMorePages = false;
      }
    }
  }
  
  return vehicles;
}

// Step 5: Scrape individual car vehicle detail page (using proven extraction logic)
async function scrapeCarVehicleDetail(detailUrl, brandName, modelName) {
  try {
    const html = await fetchPage(detailUrl);
    
    // Extract vehicle ID from URL
    const idMatch = detailUrl.match(/detail\/(\d+)/);
    const autoscoutId = idMatch ? idMatch[1] : Date.now().toString();
    
    // Extract title - use exact working pattern from complete-cars-scraper
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const title = titleMatch ? titleMatch[1].trim() : (modelName ? `${brandName} ${modelName}` : brandName);

    // Extract price - use exact working patterns from complete-cars-scraper
    const pricePatterns = [
      /CHF\s*([0-9&#x';]+)\.-/,      // "CHF 15&#x27;555.-"
      /CHF\s*([0-9&#x';]+)/,         // "CHF 15&#x27;555"
      /([0-9&#x';]+)\s*\.-/          // "15&#x27;555.-"
    ];
    
    let price = 0;
    for (const pattern of pricePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        price = extractPrice(match[1]);
        if (price > 0) break;
      }
    }
    
    // Extract year - handle new vehicles vs used vehicles
    let year = new Date().getFullYear();
    const yearSpanMatch = html.match(/Calendar icon[^>]*>.*?<span class="chakra-text[^"]*">([^<]+)<\/span>/);
    if (yearSpanMatch) {
      const yearText = yearSpanMatch[1].trim();
      if (yearText === 'Neues Fahrzeug') {
        year = new Date().getFullYear();
      } else {
        year = extractYear(yearText);
      }
    }
    
    // Extract mileage - first try the span pattern
    let mileage = 0;
    const mileageSpanMatch = html.match(/Road icon[^>]*>.*?<span class="chakra-text[^"]*">([^<]+)<\/span>/);
    if (mileageSpanMatch) {
      mileage = extractMileage(mileageSpanMatch[1]);
    }
    
    // Extract transmission - look for the span after transmission icon
    const transmissionMatch = html.match(/Transmission icon[^>]*>.*?<span class="chakra-text[^"]*">([^<]+)<\/span>/);
    const transmission = transmissionMatch ? transmissionMatch[1].trim() : 'Schaltgetriebe manuell';
    
    // Extract fuel type - look for the span after gas station icon
    const fuelMatch = html.match(/Gas station icon[^>]*>.*?<span class="chakra-text[^"]*">([^<]+)<\/span>/);
    const fuel = fuelMatch ? fuelMatch[1].trim() : 'Benzin';
    
    // Extract power - use exact working patterns from complete-cars-scraper
    let power = '-';
    const powerPatterns = [
      /Vehicle power icon([^<\n]+)/,      // "Vehicle power icon93 PS (69 kW)"
      /(\d+\s*PS\s*\(\d+\s*kW\))/,       // "93 PS (69 kW)"
      /(\d+\s*PS)/                        // "93 PS"
    ];
    
    for (const pattern of powerPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        power = match[1].trim();
        break;
      }
    }
    
    // Extract body type - handle different vehicle types (cars, campers, utility)
    const bodyTypePatterns = [
      /Car icon([^<\n]+)/,           // Regular cars
      /Vehicle icon([^<\n]+)/,       // General vehicle
      /Truck icon([^<\n]+)/,         // Utility vehicles
      /Camper icon([^<\n]+)/,        // Campers/Motorhomes
      /<span class="chakra-text css-0">([^<]+)<\/span>/  // Fallback span pattern
    ];

    let bodyType = 'Auto';
    for (const pattern of bodyTypePatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        // Map common vehicle types
        if (extracted.includes('Van') || extracted.includes('Transporter')) {
          bodyType = 'Nutzfahrzeug';
        } else if (extracted.includes('Wohnmobil') || extracted.includes('Camper') || extracted.includes('California')) {
          bodyType = 'Wohnmobil';
        } else if (extracted.length > 0 && extracted !== 'undefined') {
          bodyType = extracted;
        }
        break;
      }
    }
    
    // Extract images
    const imageMatches = html.match(/https:\/\/images\.autoscout24\.ch\/[^"'\s]+\.(jpg|jpeg|png)/g);
    const images = imageMatches ? [...new Set(imageMatches)] : [];
    
    // Extract features
    const equipmentMatches = html.match(/Serienmässige Ausstattung[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/);
    let features = [];
    if (equipmentMatches) {
      const equipmentHtml = equipmentMatches[1];
      const equipmentItems = equipmentHtml.match(/<li[^>]*>([^<]+)<\/li>/g);
      if (equipmentItems) {
        features = equipmentItems.map(item => item.replace(/<[^>]*>/g, '').trim());
      }
    }
    
    // Extract location from dealer info
    let location = 'Grenchen'; // Default fallback
    let dealer = 'Auto Vögeli AG'; // Default fallback
    
    const locationPatterns = [
      /Solothurnstrasse[^,]*,\s*(\d{4}\s+[^<\n"]+)/,  // "Solothurnstrasse 129, 2540 Grenchen"
      /(\d{4}\s+Grenchen)/,                           // "2540 Grenchen"
      /"city":"([^"]+)"/,                             // JSON: "city":"Grenchen"
    ];
    
    for (const pattern of locationPatterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        const extracted = match[1].trim();
        if (extracted.includes('Grenchen')) {
          location = 'Grenchen';
          break;
        } else if (extracted.includes('Langenthal')) {
          location = 'Langenthal';
          break;
        }
      }
    }
    
    // Extract dealer name
    const dealerPatterns = [
      /"name":"(Auto Vögeli[^"]*)"/, // JSON: "name":"Auto Vögeli AG"
      /Auto Vögeli AG/,
      /Auto Voegeli AG/
    ];
    
    for (const pattern of dealerPatterns) {
      const match = html.match(pattern);
      if (match) {
        dealer = match[1] || 'Auto Vögeli AG';
        break;
      }
    }
    
    // Extract model - use provided modelName or extract from title
    let finalModel = modelName;
    if (!modelName) {
      // For brands without model breakdown, extract model from title
      const titleParts = title.split(' ');
      const brandIndex = titleParts.findIndex(part => 
        part.toUpperCase() === brandName.toUpperCase()
      );
      
      if (brandIndex !== -1 && brandIndex < titleParts.length - 1) {
        // Take first few words after brand, stop at specifications
        const modelParts = titleParts.slice(brandIndex + 1);
        const smartModel = [];
        
        for (let part of modelParts) {
          // Stop at common specification indicators
          if (part.includes('kW') || part.includes('PS') || part.includes('ABS') || 
              part.includes('LED') || part.includes('TFT') || part.includes('mit') ||
              part.includes('Display') || part.includes('35kW') || part.includes('47kW')) {
            break;
          }
          
          smartModel.push(part);
          
          // Stop after 3 meaningful parts for most cars
          if (smartModel.length >= 3) break;
        }
        
        finalModel = smartModel.length > 0 ? smartModel.join(' ') : 'Standard';
      } else {
        finalModel = 'Standard';
      }
    }

    // Generate descriptive ID: brand-model-autoscoutid
    const cleanBrand = brandName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const cleanModel = finalModel.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const descriptiveId = `${cleanBrand}-${cleanModel}-${autoscoutId}`;

    // Create multilingual object for car translations
    const getGermanTransmission = (transmission) => {
      const transmissionMap = {
        'manual': 'Schaltgetriebe manuell',
        'automatic': 'Automat',
        'semi-automatic': 'Halbautomatisches Getriebe',
        'Schaltgetriebe manuell': 'Schaltgetriebe manuell',
        'Automat': 'Automat',
        'Halbautomatisches Getriebe': 'Halbautomatisches Getriebe'
      };
      return transmissionMap[transmission] || transmission || 'Schaltgetriebe manuell';
    };

    const getCarBodyType = (bodyType) => {
      if (bodyType === 'Nutzfahrzeug') {
        return { de: 'Nutzfahrzeug', en: 'Commercial Vehicle', fr: 'Véhicule utilitaire' };
      } else if (bodyType === 'Wohnmobil') {
        return { de: 'Wohnmobil', en: 'Motorhome', fr: 'Camping-car' };
      } else {
        return { de: 'Auto', en: 'Car', fr: 'Voiture' };
      }
    };

    const carBodyType = getCarBodyType(bodyType);

    const multilingual = {
      fuel: {
        de: fuel === 'Benzin' ? 'Benzin' : fuel === 'Diesel' ? 'Diesel' : fuel === 'Elektro' ? 'Elektro' : fuel.includes('Hybrid') ? 'Hybrid' : 'Benzin',
        en: fuel === 'Benzin' ? 'Petrol' : fuel === 'Diesel' ? 'Diesel' : fuel === 'Elektro' ? 'Electric' : fuel.includes('Hybrid') ? 'Hybrid' : 'Petrol',
        fr: fuel === 'Benzin' ? 'Essence' : fuel === 'Diesel' ? 'Diesel' : fuel === 'Elektro' ? 'Électrique' : fuel.includes('Hybrid') ? 'Hybride' : 'Essence'
      },
      brand: {
        de: brandName,
        en: brandName,
        fr: brandName
      },
      color: {
        de: "Metallic",
        en: "Metallic",
        fr: "Métallique"
      },
      bodyType: carBodyType,
      features: {
        de: features || ["ABS", "Klimaanlage", "Navigation"],
        en: features || ["ABS", "Air Conditioning", "Navigation"],
        fr: features || ["ABS", "Climatisation", "Navigation"]
      },
      warranty: {
        de: "12 Monate",
        en: "12 Months",
        fr: "12 Mois"
      },
      condition: {
        de: (year >= 2024 && mileage < 100) ? "Neu" : "Gebraucht",
        en: (year >= 2024 && mileage < 100) ? "New" : "Used",
        fr: (year >= 2024 && mileage < 100) ? "Neuf" : "Occasion"
      },
      description: {
        de: `Hochwertiges ${brandName} ${finalModel} Baujahr ${year} von Auto Vögeli AG.`,
        en: `High-quality ${brandName} ${finalModel} from ${year} by Auto Vögeli AG.`,
        fr: `Véhicule de qualité ${brandName} ${finalModel} de ${year} d'Auto Vögeli AG.`
      },
      transmission: {
        de: getGermanTransmission(transmission),
        en: transmission === 'Automat' ? "Automatic transmission" :
            transmission === 'Halbautomatisches Getriebe' ? "Semi-automatic transmission" :
            transmission === 'Schaltgetriebe manuell' ? "Manual transmission" : "Manual transmission",
        fr: transmission === 'Automat' ? "Transmission automatique" :
            transmission === 'Halbautomatisches Getriebe' ? "Transmission semi-automatique" :
            transmission === 'Schaltgetriebe manuell' ? "Transmission manuelle" : "Transmission manuelle"
      }
    };

    return {
      id: descriptiveId,
      title,
      brand: brandName,
      model: finalModel,
      year,
      price,
      mileage,
      fuel,
      transmission,
      power,
      bodyType,
      condition: year >= 2024 && mileage < 100 ? 'new' : 'used',
      description: `Hochwertiges ${brandName} ${finalModel} Baujahr ${year} von Auto Vögeli AG.`,
      features,
      images,
      detailUrl,
      location,
      dealer,
      category: 'car', // All cars use 'car' category
      multilingual: JSON.stringify(multilingual)
    };
    
  } catch (error) {
    console.error(`❌ Error scraping car detail ${detailUrl}:`, error.message);
    return null;
  }
}

// Step 6: Format vehicle data for Supabase
function formatCarVehicleData(vehicleDetail) {
  return {
    id: vehicleDetail.id, // Already generated as descriptive ID above
    category: vehicleDetail.category || 'car',
    title: vehicleDetail.title,
    brand: vehicleDetail.brand,
    model: vehicleDetail.model,
    year: vehicleDetail.year,
    price: vehicleDetail.price,
    mileage: vehicleDetail.mileage,
    fuel: vehicleDetail.fuel,
    transmission: vehicleDetail.transmission,
    power: vehicleDetail.power,
    body_type: vehicleDetail.bodyType,
    color: null,
    images: JSON.stringify(vehicleDetail.images || []),
    description: vehicleDetail.description,
    features: JSON.stringify(vehicleDetail.features || []),
    location: vehicleDetail.location,
    dealer: vehicleDetail.dealer,
    url: vehicleDetail.detailUrl,
    condition: vehicleDetail.condition,
    first_registration: null,
    doors: null,
    seats: null,
    co2_emission: null,
    consumption: null,
    warranty: 'Gewerbliche Garantie',
    warranty_details: 'Gewerbliche Garantie',
    warranty_months: parseInt(12),
    mfk: null,
    displacement: null,
    drive: null,
    vehicle_age: new Date().getFullYear() - vehicleDetail.year,
    price_per_year: Math.round(vehicleDetail.price / Math.max(new Date().getFullYear() - vehicleDetail.year, 1)),
    multilingual: vehicleDetail.multilingual
  };
}

// Step 7: Replace all cars in Supabase
async function replaceAllCarsInSupabase(vehicles) {
  try {
    console.log('🧹 Clearing existing cars from Supabase...');
    
    // Delete all existing cars
    const { error: deleteError } = await supabase
      .from('vehicles')
      .delete()
      .eq('category', 'car');
    
    if (deleteError) {
      console.error('❌ Error deleting existing cars:', deleteError.message);
      return false;
    }
    
    console.log('✅ Cleared all existing cars');
    
    if (vehicles.length === 0) {
      console.log('ℹ️ No new vehicles to insert');
      return true;
    }
    
    console.log(`🔄 Inserting ${vehicles.length} fresh cars to Supabase...`);
    
    const { error: insertError } = await supabase
      .from('vehicles')
      .insert(vehicles);
      
    if (insertError) {
      console.error('❌ Error inserting new cars:', insertError);
      return false;
    }
    
    console.log(`✅ Successfully inserted ${vehicles.length} fresh cars to Supabase`);
    return true;
    
  } catch (error) {
    console.error('❌ Error in replaceAllCarsInSupabase:', error.message);
    return false;
  }
}

// Main function: Smart Brand-Model car scraping
async function smartScrapeAllCars() {
  console.log('🚀 Starting smart brand-model car scraping...');
  
  try {
    // Step 1: Get all brands
    const brands = await getAllCarBrands();
    if (brands.length === 0) {
      console.log('❌ No brands found, aborting');
      return;
    }
    
    const allVehicles = [];
    
    // Step 2: For each brand, get models and scrape
    for (const brandObj of brands) { // Process all available brands
      const brandName = brandObj.name;
      const brandKey = brandObj.key;
      console.log(`\n🏷️ Processing brand: ${brandName}`);
      
      const models = await getModelsForCarBrand(brandKey, brandName);
      
      if (models.length === 0) {
        console.log(`⚠️ No models found for ${brandName}, but checking for vehicles without model filter...`);
        const brandVehicles = await scrapeVehiclesForCarBrand(brandKey, brandName);
        allVehicles.push(...brandVehicles);
      } else {
        console.log(`📊 Found ${models.length} model(s) for ${brandName} - processing all models\n`);
        
        for (const model of models) {
          console.log(`🏍️ Processing ${brandName} ${model.name}`);
          const modelVehicles = await scrapeVehiclesForCarBrandModel(brandKey, brandName, model.name, model.key);
          allVehicles.push(...modelVehicles);
        }
      }
    }
    
    console.log(`\n📊 Successfully scraped ${allVehicles.length} cars across all brands and models`);
    
    // Step 3: Format for Supabase
    const formattedVehicles = allVehicles.map(formatCarVehicleData);
    
    // Step 4: Replace in Supabase
    const success = await replaceAllCarsInSupabase(formattedVehicles);
    
    if (success) {
      console.log('✅ Smart brand-model car scraping completed successfully!');
    } else {
      console.log('❌ Car scraping completed but database update failed');
    }
    
  } catch (error) {
    console.error('❌ Error in smartScrapeAllCars:', error.message);
  }
}

// Run the scraper
if (require.main === module) {
  smartScrapeAllCars().catch(console.error);
}

module.exports = { smartScrapeAllCars };
