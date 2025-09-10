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

// Step 1: Get all available brands from AutoScout24
async function getAllBrands() {
  console.log('🏷️ Getting all available motorcycle brands...');
  
  try {
    const html = await fetchPage('https://www.autoscout24.ch/de/hci/v2/1124/search');
    
    // Extract brand options from the makeKey select dropdown
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
    
    console.log(`✅ Found ${brands.length} brands:`, brands.map(b => b.name).join(', '));
    return brands;
    
  } catch (error) {
    console.error('❌ Error getting brands:', error.message);
    return [];
  }
}

// Step 2: Get all models for a specific brand
async function getModelsForBrand(brandKey, brandName) {
  console.log(`🏍️ Getting models for ${brandName}...`);
  
  try {
    const html = await fetchPage(`https://www.autoscout24.ch/de/hci/v2/1124/search?makeKey=${brandKey}`);
    
    // Extract model options from the modelKey select dropdown
    const modelSelectMatch = html.match(/<select[^>]*name=["']modelKey["'][^>]*>([\s\S]*?)<\/select>/);
    
    if (!modelSelectMatch) {
      console.log(`❌ No model selector found for ${brandName}`);
      return [];
    }
    
    const modelOptions = modelSelectMatch[1].match(/<option[^>]*value=["']([^"']+)["'][^>]*>([^<]+)<\/option>/g);
    
    if (!modelOptions) {
      console.log(`❌ No model options found for ${brandName}`);
      return [];
    }
    
    const models = [];
    for (const option of modelOptions) {
      const match = option.match(/value=["']([^"']+)["'][^>]*>([^<]+)/);
      if (match && match[1] && match[2] && match[1] !== '' && 
          match[2].trim().toLowerCase() !== 'alle' && match[2].trim().toLowerCase() !== 'all') {
        models.push({
          key: match[1].toLowerCase(),
          name: match[2].trim()
        });
      }
    }
    
    console.log(`✅ Found ${models.length} models for ${brandName}:`, models.map(m => m.name).join(', '));
    return models;
    
  } catch (error) {
    console.error(`❌ Error getting models for ${brandName}:`, error.message);
    return [];
  }
}

// Step 3a: Scrape vehicles for a brand without model filter
async function scrapeVehiclesForBrand(brandKey, brandName) {
  console.log(`🔍 Scraping all ${brandName} vehicles...`);
  
  const vehicles = [];
  let page = 0;
  let hasMorePages = true;
  
  while (hasMorePages) {
    try {
      const pageUrl = page === 0 
        ? `https://www.autoscout24.ch/de/hci/v2/1124/search?makeKey=${brandKey}`
        : `https://www.autoscout24.ch/de/hci/v2/1124/search?makeKey=${brandKey}&page=${page}`;
      
      console.log(`📄 Scraping ${brandName} page ${page + 1}`);
      
      const html = await fetchPage(pageUrl);
      
      // Extract vehicle URLs from the page
      const urlMatches = html.match(/\/de\/hci\/v2\/1124\/detail\/\d+/g);
      
      if (urlMatches && urlMatches.length > 0) {
        const pageUrls = urlMatches.map(url => `https://www.autoscout24.ch${url}`);
        
        // Scrape each vehicle detail page
        for (const detailUrl of pageUrls) {
          const vehicleDetail = await scrapeVehicleDetail(detailUrl, brandName, null); // No specific model
          if (vehicleDetail) {
            vehicles.push(vehicleDetail);
            console.log(`✅ Scraped: ${vehicleDetail.title} - ${vehicleDetail.price} CHF`);
          }
          
          // Add delay between requests
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        page++;
      } else {
        hasMorePages = false;
        console.log(`🏁 No more vehicles found for ${brandName}`);
      }
      
      // Safety limit
      if (page > 5) {
        console.log(`⚠️ Reached page limit for ${brandName}`);
        hasMorePages = false;
      }
      
    } catch (error) {
      console.error(`❌ Error scraping ${brandName} page ${page + 1}:`, error.message);
      hasMorePages = false;
    }
  }
  
  return vehicles;
}

// Step 3b: Scrape vehicles for a specific brand-model combination
async function scrapeVehiclesForBrandModel(brandKey, brandName, modelKey, modelName) {
  console.log(`🔍 Scraping ${brandName} ${modelName}...`);
  
  const vehicles = [];
  let page = 0;
  let hasMorePages = true;
  
  while (hasMorePages) {
    try {
      const pageUrl = page === 0 
        ? `https://www.autoscout24.ch/de/hci/v2/1124/search?makeKey=${brandKey}&modelKey=${modelKey}`
        : `https://www.autoscout24.ch/de/hci/v2/1124/search?makeKey=${brandKey}&modelKey=${modelKey}&page=${page}`;
      
      console.log(`📄 Scraping ${brandName} ${modelName} page ${page + 1}`);
      
      const html = await fetchPage(pageUrl);
      
      // Extract vehicle URLs from the page
      const urlMatches = html.match(/\/de\/hci\/v2\/1124\/detail\/\d+/g);
      
      if (urlMatches && urlMatches.length > 0) {
        const pageUrls = urlMatches.map(url => `https://www.autoscout24.ch${url}`);
        
        // Scrape each vehicle detail page
        for (const detailUrl of pageUrls) {
          const vehicleDetail = await scrapeVehicleDetail(detailUrl, brandName, modelName);
          if (vehicleDetail) {
            vehicles.push(vehicleDetail);
            console.log(`✅ Scraped: ${vehicleDetail.title} - ${vehicleDetail.price} CHF`);
          }
          
          // Add delay between requests
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        page++;
      } else {
        hasMorePages = false;
        console.log(`🏁 No more vehicles found for ${brandName} ${modelName}`);
      }
      
      // Safety limit
      if (page > 5) {
        console.log(`⚠️ Reached page limit for ${brandName} ${modelName}`);
        hasMorePages = false;
      }
      
    } catch (error) {
      console.error(`❌ Error scraping ${brandName} ${modelName} page ${page + 1}:`, error.message);
      hasMorePages = false;
    }
  }
  
  return vehicles;
}

// Step 4: Scrape individual vehicle detail page (using proven extraction logic)
async function scrapeVehicleDetail(detailUrl, brandName, modelName) {
  try {
    const html = await fetchPage(detailUrl);
    
    // Extract vehicle ID from URL
    const idMatch = detailUrl.match(/detail\/(\d+)/);
    const autoscoutId = idMatch ? idMatch[1] : Date.now().toString();
    
    // Extract title - use exact working pattern from complete-bikes-scraper
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/);
    const title = titleMatch ? titleMatch[1].trim() : (modelName ? `${brandName} ${modelName}` : brandName);

    // Extract price - use exact working patterns from complete-bikes-scraper
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
    } else {
      // Fallback year patterns
      const yearPatterns = [
        /(\d{2})\.(\d{4})/,
        /Baujahr[^>]*>.*?(\d{4})/,
        /Jahr[^>]*>.*?(\d{4})/
      ];
      
      for (const pattern of yearPatterns) {
        const match = html.match(pattern);
        if (match) {
          const foundYear = parseInt(match[match.length - 1]);
          if (foundYear >= 1990 && foundYear <= 2025) {
            year = foundYear;
            break;
          }
        }
      }
    }
    
    // Extract mileage - try multiple patterns
    let mileage = 0;
    const mileageSpanMatch = html.match(/Road icon[^>]*>.*?<span class="chakra-text[^"]*">([^<]+)<\/span>/);
    if (mileageSpanMatch) {
      mileage = extractMileage(mileageSpanMatch[1]);
    } else {
      // Fallback mileage patterns
      const mileagePatterns = [
        /(\d+['']?\d*)\s*km/i,
        /Kilometerstand[^>]*>.*?(\d+['']?\d*)/,
        /(\d+)\s*Kilometer/
      ];
      
      for (const pattern of mileagePatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          mileage = extractMileage(match[1]);
          if (mileage > 0) break;
        }
      }
    }
    
    // Extract fuel type
    const fuelSpanMatch = html.match(/Gas station icon[^>]*>.*?<span class="chakra-text[^"]*">([^<]+)<\/span>/);
    let fuel = 'Benzin';
    if (fuelSpanMatch) {
      fuel = fuelSpanMatch[1].trim();
    } else {
      // Fallback fuel patterns
      const fuelPatterns = [
        /Treibstoff[^>]*>.*?(Benzin|Diesel|Elektro)/i,
        /(Benzin|Diesel|Elektro)/i
      ];
      
      for (const pattern of fuelPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          fuel = match[1].trim();
          break;
        }
      }
    }
    
    // Extract transmission
    const transmissionSpanMatch = html.match(/Transmission icon[^>]*>.*?<span class="chakra-text[^"]*">([^<]+)<\/span>/);
    let transmission = 'Schaltgetriebe manuell';
    if (transmissionSpanMatch) {
      transmission = transmissionSpanMatch[1].trim();
    } else {
      // Fallback transmission patterns
      const transmissionPatterns = [
        /(Stufenlos|Automat|Schaltgetriebe)/i,
        /Getriebe[^>]*>.*?(Stufenlos|Automat|Schaltgetriebe)/i
      ];
      
      for (const pattern of transmissionPatterns) {
        const match = html.match(pattern);
        if (match && match[1]) {
          transmission = match[1].trim();
          break;
        }
      }
    }
    
    // Extract power - use exact working patterns from complete-bikes-scraper
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
    
    // Extract images
    const imageMatches = html.match(/https:\/\/images\.autoscout24\.ch\/[^"'\s]+\.(jpg|jpeg|png)/g);
    const images = imageMatches ? [...new Set(imageMatches)] : [];
    
    // Extract description (if any)
    const descriptionMatch = html.match(/<p[^>]*>([^<]*(?:Sehr schöne|Wunderschöne|Gepflegte|Tolle|Verkaufe|Biete)[^<]{10,}[!.])<\/p>/);
    const description = descriptionMatch ? descriptionMatch[1].trim() : null;
    
    // Extract MFK info
    const mfkMatch = html.match(/Letzte MFK[\s\S]*?(\d{2}\.\d{2}\.\d{4})/);
    const mfk = mfkMatch ? mfkMatch[1] : null;
    
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
          
          // Stop after 3 meaningful parts for most bikes
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

    // Create multilingual object for translations
    const getGermanTransmission = (transmission) => {
      const transmissionMap = {
        'manual': 'Schaltgetriebe manuell',
        'automatic': 'Automat',
        'automatic-stepless': 'Stufenlos',
        'Schaltgetriebe manuell': 'Schaltgetriebe manuell',
        'Automat': 'Automat',
        'Stufenlos': 'Stufenlos'
      };
      return transmissionMap[transmission] || transmission || 'Schaltgetriebe manuell';
    };

    const multilingual = {
      fuel: {
        de: fuel === 'Benzin' ? 'Benzin' : fuel === 'Diesel' ? 'Diesel' : fuel === 'Elektro' ? 'Elektro' : 'Benzin',
        en: fuel === 'Benzin' ? 'Petrol' : fuel === 'Diesel' ? 'Diesel' : fuel === 'Elektro' ? 'Electric' : 'Petrol',
        fr: fuel === 'Benzin' ? 'Essence' : fuel === 'Diesel' ? 'Diesel' : fuel === 'Elektro' ? 'Électrique' : 'Essence'
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
      bodyType: {
        de: "Motorrad",
        en: "Motorcycle",
        fr: "Moto"
      },
      features: {
        de: features || ["ABS", "LED", "Digital"],
        en: features || ["ABS", "LED", "Digital"],
        fr: features || ["ABS", "LED", "Numérique"]
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
        de: description || `Hochwertiges ${brandName} ${finalModel} Baujahr ${year} von Auto Vögeli AG.`,
        en: `High-quality ${brandName} ${finalModel} from ${year} by Auto Vögeli AG.`,
        fr: `Véhicule de qualité ${brandName} ${finalModel} de ${year} d'Auto Vögeli AG.`
      },
      transmission: {
        de: getGermanTransmission(transmission),
        en: transmission === 'Stufenlos' ? "Stepless automatic" : 
            transmission === 'Automat' ? "Automatic transmission" :
            transmission === 'Schaltgetriebe manuell' ? "Manual transmission" : "Manual transmission",
        fr: transmission === 'Stufenlos' ? "Automatique sans étages" :
            transmission === 'Automat' ? "Transmission automatique" :
            transmission === 'Schaltgetriebe manuell' ? "Transmission manuelle" : "Transmission manuelle"
      }
    };

    return {
      id: descriptiveId,
      title,
      brand: brandName,
      model: finalModel, // Clean model name from dropdown or extracted from title
      year,
      price,
      mileage,
      fuel,
      transmission,
      power,
      bodyType: 'Motorrad',
      condition: year >= 2024 && mileage < 100 ? 'new' : 'used',
      description,
      features,
      images,
      mfk,
      guarantee: '12 Monate',
      detailUrl,
      location,
      dealer,
      multilingual: JSON.stringify(multilingual)
    };
    
  } catch (error) {
    console.error(`❌ Error scraping detail ${detailUrl}:`, error.message);
    return null;
  }
}

// Step 5: Format vehicle data for Supabase
function formatVehicleData(vehicleDetail) {
  const getGermanTransmission = (transmission) => {
    const transmissionMap = {
      'Stufenlos': 'Stufenlos',
      'Automatik': 'Automat',
      'Schaltgetriebe manuell': 'Schaltgetriebe manuell',
      'Halbautomatisches Getriebe': 'Halbautomatisches Getriebe'
    };
    return transmissionMap[transmission] || transmission;
  };

  const getGermanFuel = (fuel) => {
    const fuelMap = {
      'Benzin': 'Benzin',
      'Elektro': 'Elektro',
      'Diesel': 'Diesel'
    };
    return fuelMap[fuel] || fuel;
  };

  return {
    id: vehicleDetail.id, // Already generated as descriptive ID above
    category: 'bike',
    title: vehicleDetail.title,
    brand: vehicleDetail.brand,
    model: vehicleDetail.model,
    year: vehicleDetail.year,
    price: vehicleDetail.price,
    mileage: vehicleDetail.mileage,
    fuel: getGermanFuel(vehicleDetail.fuel),
    transmission: getGermanTransmission(vehicleDetail.transmission),
    power: vehicleDetail.power,
    body_type: vehicleDetail.bodyType,
    color: null,
    images: vehicleDetail.images,
    description: vehicleDetail.description,
    features: vehicleDetail.features,
    location: vehicleDetail.location,
    dealer: vehicleDetail.dealer,
    url: vehicleDetail.detailUrl,
    condition: vehicleDetail.condition,
    first_registration: null,
    doors: null,
    seats: null,
    co2_emission: null,
    consumption: null,
    warranty: vehicleDetail.guarantee,
    warranty_details: vehicleDetail.guarantee,
    warranty_months: 12,
    mfk: vehicleDetail.mfk,
    displacement: null,
    drive: null,
    vehicle_age: new Date().getFullYear() - vehicleDetail.year,
    price_per_year: Math.round(vehicleDetail.price / Math.max(new Date().getFullYear() - vehicleDetail.year, 1)),
    multilingual: vehicleDetail.multilingual
  };
}

// Step 6: Replace all bikes in Supabase
async function replaceAllBikesInSupabase(vehicles) {
  console.log('🧹 Clearing existing bikes from Supabase...');
  
  try {
    const { error: deleteError } = await supabase
      .from('vehicles')
      .delete()
      .eq('category', 'bike');
      
    if (deleteError) {
      console.error('❌ Error clearing existing bikes:', deleteError);
      return false;
    }
    
    console.log('✅ Cleared all existing bikes');
    
    if (vehicles.length === 0) {
      console.log('ℹ️ No new vehicles to insert');
      return true;
    }
    
    console.log(`🔄 Inserting ${vehicles.length} fresh bikes to Supabase...`);
    
    const { error: insertError } = await supabase
      .from('vehicles')
      .insert(vehicles);
      
    if (insertError) {
      console.error('❌ Error inserting new bikes:', insertError);
      return false;
    }
    
    console.log(`✅ Successfully inserted ${vehicles.length} fresh bikes to Supabase`);
    return true;
    
  } catch (error) {
    console.error('❌ Error in replaceAllBikesInSupabase:', error.message);
    return false;
  }
}

// Main function: Smart Brand-Model scraping
async function smartScrapeAllBikes() {
  console.log('🚀 Starting smart brand-model bike scraping...');
  
  try {
    // Step 1: Get all brands
    const brands = await getAllBrands();
    if (brands.length === 0) {
      console.log('❌ No brands found, aborting');
      return;
    }
    
    const allVehicles = [];
    
    // Step 2: For each brand, get models and scrape vehicles
    for (const brand of brands) {
      console.log(`\n🏷️ Processing brand: ${brand.name}`);
      
      const models = await getModelsForBrand(brand.key, brand.name);
      
      if (models.length === 0) {
        console.log(`⚠️ No models found for ${brand.name}, but checking for vehicles without model filter...`);
        
        // Scrape brand directly without model filter
        const vehicles = await scrapeVehiclesForBrand(brand.key, brand.name);
        
        // Format and add to collection
        for (const vehicle of vehicles) {
          const formattedVehicle = formatVehicleData(vehicle);
          allVehicles.push(formattedVehicle);
        }
        
        continue;
      }
      
      // Step 3: For each model, scrape vehicles (including single model brands)
      console.log(`📊 Found ${models.length} model(s) for ${brand.name} - processing all models`);
      
      for (const model of models) {
        console.log(`\n🏍️ Processing ${brand.name} ${model.name}`);
        
        const vehicles = await scrapeVehiclesForBrandModel(brand.key, brand.name, model.key, model.name);
        
        // Format and add to collection
        for (const vehicle of vehicles) {
          const formattedVehicle = formatVehicleData(vehicle);
          allVehicles.push(formattedVehicle);
        }
        
        // Add delay between models
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      
      // Add delay between brands
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    console.log(`\n📊 Successfully scraped ${allVehicles.length} bikes across all brands and models`);
    
    // Step 4: Replace all bikes in Supabase
    await replaceAllBikesInSupabase(allVehicles);
    
    console.log('✅ Smart brand-model bike scraping completed successfully!');
    
  } catch (error) {
    console.error('❌ Error in smartScrapeAllBikes:', error.message);
  }
}

// Run the smart scraper
if (require.main === module) {
  smartScrapeAllBikes();
}

module.exports = { smartScrapeAllBikes };
