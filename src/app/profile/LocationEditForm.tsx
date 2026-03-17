'use client'

import { useState } from 'react'
import Link from 'next/link'
import { updateLocation } from '@/app/profile/actions'

// ── City lists per country (sorted alphabetically within each country) ─────────
const CITY_MAP: Record<string, string[]> = {
  'Argentina':      ['Buenos Aires', 'Córdoba', 'Mar del Plata', 'Mendoza', 'Rosario', 'Salta'],
  'Australia':      ['Adelaide', 'Brisbane', 'Canberra', 'Gold Coast', 'Hobart', 'Melbourne', 'Perth', 'Sydney'],
  'Austria':        ['Graz', 'Innsbruck', 'Linz', 'Salzburg', 'Vienna'],
  'Belgium':        ['Antwerp', 'Bruges', 'Brussels', 'Ghent', 'Liège'],
  'Brazil':         ['Belo Horizonte', 'Brasília', 'Curitiba', 'Fortaleza', 'Manaus', 'Porto Alegre', 'Recife', 'Rio de Janeiro', 'Salvador', 'São Paulo'],
  'Bulgaria':       ['Burgas', 'Plovdiv', 'Ruse', 'Sofia', 'Varna'],
  'Canada':         ['Calgary', 'Edmonton', 'Hamilton', 'Montreal', 'Ottawa', 'Quebec City', 'Toronto', 'Vancouver', 'Winnipeg'],
  'Chile':          ['Antofagasta', 'Concepción', 'La Serena', 'Santiago', 'Valparaíso'],
  'China':          ['Beijing', 'Chengdu', 'Guangzhou', 'Hangzhou', 'Nanjing', 'Shanghai', 'Shenzhen', 'Wuhan', "Xi'an"],
  'Colombia':       ['Barranquilla', 'Bogotá', 'Cali', 'Cartagena', 'Medellín'],
  'Croatia':        ['Dubrovnik', 'Osijek', 'Rijeka', 'Split', 'Zadar', 'Zagreb'],
  'Czech Republic': ['Brno', 'Liberec', 'Ostrava', 'Plzeň', 'Prague'],
  'Denmark':        ['Aalborg', 'Aarhus', 'Copenhagen', 'Esbjerg', 'Odense'],
  'Ecuador':        ['Ambato', 'Cuenca', 'Guayaquil', 'Quito', 'Santo Domingo'],
  'Finland':        ['Espoo', 'Helsinki', 'Oulu', 'Tampere', 'Turku', 'Vantaa'],
  'France':         ['Bordeaux', 'Lille', 'Lyon', 'Marseille', 'Montpellier', 'Nantes', 'Nice', 'Paris', 'Strasbourg', 'Toulouse'],
  'Germany':        ['Berlin', 'Cologne', 'Dortmund', 'Dresden', 'Düsseldorf', 'Frankfurt', 'Hamburg', 'Leipzig', 'Munich', 'Stuttgart'],
  'Great Britain':  ['Birmingham', 'Bristol', 'Edinburgh', 'Glasgow', 'Leeds', 'Liverpool', 'London', 'Manchester', 'Newcastle', 'Sheffield'],
  'Greece':         ['Athens', 'Heraklion', 'Larissa', 'Patras', 'Thessaloniki', 'Volos'],
  'Hungary':        ['Budapest', 'Debrecen', 'Miskolc', 'Pécs', 'Szeged'],
  'India':          ['Ahmedabad', 'Bengaluru', 'Chennai', 'Delhi', 'Hyderabad', 'Jaipur', 'Kolkata', 'Mumbai', 'Pune', 'Surat'],
  'Ireland':        ['Cork', 'Dublin', 'Galway', 'Limerick', 'Waterford'],
  'Israel':         ['Beersheba', 'Haifa', 'Jerusalem', 'Netanya', 'Tel Aviv'],
  'Italy':          ['Bari', 'Bologna', 'Florence', 'Genoa', 'Milan', 'Naples', 'Palermo', 'Rome', 'Turin', 'Venice'],
  'Japan':          ['Fukuoka', 'Hiroshima', 'Kobe', 'Kyoto', 'Nagoya', 'Osaka', 'Sapporo', 'Sendai', 'Tokyo', 'Yokohama'],
  'Kazakhstan':     ['Aktobe', 'Almaty', 'Astana', 'Karaganda', 'Shymkent'],
  'Latvia':         ['Daugavpils', 'Jelgava', 'Jēkabpils', 'Liepāja', 'Riga'],
  'Mexico':         ['Ciudad de México', 'Guadalajara', 'Juárez', 'León', 'Mérida', 'Monterrey', 'Puebla', 'Tijuana', 'Zapopan'],
  'Netherlands':    ['Amsterdam', 'Eindhoven', 'Groningen', 'Rotterdam', 'The Hague', 'Tilburg', 'Utrecht'],
  'New Zealand':    ['Auckland', 'Christchurch', 'Dunedin', 'Hamilton', 'Tauranga', 'Wellington'],
  'Norway':         ['Bergen', 'Oslo', 'Stavanger', 'Tromsø', 'Trondheim'],
  'Poland':         ['Gdańsk', 'Kraków', 'Łódź', 'Poznań', 'Szczecin', 'Warsaw', 'Wrocław'],
  'Portugal':       ['Aveiro', 'Braga', 'Coimbra', 'Funchal', 'Lisbon', 'Porto', 'Setúbal'],
  'Romania':        ['Brașov', 'Bucharest', 'Cluj-Napoca', 'Constanța', 'Iași', 'Timișoara'],
  'Russia':         ['Chelyabinsk', 'Kazan', 'Moscow', 'Nizhny Novgorod', 'Novosibirsk', 'Omsk', 'Rostov-on-Don', 'Saint Petersburg', 'Samara', 'Yekaterinburg'],
  'Serbia':         ['Belgrade', 'Kragujevac', 'Niš', 'Novi Sad', 'Subotica'],
  'Slovakia':       ['Bratislava', 'Košice', 'Nitra', 'Prešov', 'Žilina'],
  'Slovenia':       ['Celje', 'Kranj', 'Ljubljana', 'Maribor', 'Velenje'],
  'South Korea':    ['Busan', 'Daegu', 'Daejeon', 'Gwangju', 'Incheon', 'Seoul', 'Suwon', 'Ulsan'],
  'Spain':          ['Barcelona', 'Bilbao', 'Las Palmas', 'Madrid', 'Málaga', 'Murcia', 'Palma', 'Seville', 'Valencia', 'Zaragoza'],
  'Sweden':         ['Gothenburg', 'Linköping', 'Malmö', 'Örebro', 'Stockholm', 'Uppsala', 'Västerås'],
  'Switzerland':    ['Basel', 'Bern', 'Geneva', 'Lausanne', 'Winterthur', 'Zurich'],
  'Taiwan':         ['Hsinchu', 'Kaohsiung', 'Taichung', 'Tainan', 'Taipei'],
  'Tunisia':        ['Ettadhamen', 'Kairouan', 'Sfax', 'Sousse', 'Tunis'],
  'Ukraine':        ['Dnipro', 'Donetsk', 'Kharkiv', 'Kyiv', 'Lviv', 'Odessa', 'Zaporizhzhia'],
  'United States':  ['Austin', 'Chicago', 'Dallas', 'Denver', 'Houston', 'Los Angeles', 'Miami', 'New York', 'Philadelphia', 'Phoenix', 'San Antonio', 'San Diego', 'San Francisco', 'Seattle', 'Washington D.C.'],
  'Uruguay':        ['Ciudad de la Costa', 'Las Piedras', 'Montevideo', 'Paysandú', 'Salto'],
}

const COUNTRIES = Object.keys(CITY_MAP).sort()

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.7rem',
  color: 'var(--muted)',
  letterSpacing: '0.06em',
  display: 'block',
  marginBottom: '0.4rem',
}

const selectStyle: React.CSSProperties = {
  borderColor: 'var(--chalk-dim)',
  fontFamily: 'var(--font-mono)',
  background: 'white',
}

export default function LocationEditForm({
  username,
  defaultCountry,
  defaultCity,
}: {
  username: string
  defaultCountry: string | null
  defaultCity: string | null
}) {
  const [country, setCountry] = useState(defaultCountry ?? '')

  const cities = CITY_MAP[country] ?? []
  // Only pre-select the saved city if it appears in the dropdown for this country
  const defaultCityValue = cities.includes(defaultCity ?? '') ? (defaultCity ?? '') : ''

  return (
    <div className="mb-8 bg-white rounded-sm border p-6" style={{ borderColor: 'var(--chalk-dim)' }}>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.1rem', marginBottom: '1.25rem' }}>
        Set your location
      </h2>

      <form action={updateLocation} className="flex flex-col gap-4">
        <input type="hidden" name="username" value={username} />

        {/* ── Country ─────────────────────────────────────────────────────── */}
        <div>
          <label style={labelStyle}>COUNTRY</label>
          <select
            name="country"
            value={country}
            onChange={e => setCountry(e.target.value)}
            className="w-full px-3 py-2 rounded-sm border text-sm"
            style={selectStyle}
          >
            <option value="">— Not set —</option>
            {COUNTRIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* ── City ─────────────────────────────────────────────────────────── */}
        {/* key={country} unmounts/remounts the select when country changes,   */}
        {/* which resets it to defaultValue="" automatically.                  */}
        <div>
          <label style={labelStyle}>CITY</label>
          <select
            key={country}
            name="city"
            defaultValue={defaultCityValue}
            disabled={!country}
            className="w-full px-3 py-2 rounded-sm border text-sm"
            style={{
              ...selectStyle,
              color: !country ? 'var(--muted)' : 'inherit',
              opacity: !country ? 0.6 : 1,
            }}
          >
            <option value="">
              {country ? '— Not set —' : '— Select a country first —'}
            </option>
            {cities.map(city => (
              <option key={city} value={city}>{city}</option>
            ))}
          </select>
        </div>

        {/* ── Actions ──────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            className="px-5 py-2 text-sm font-medium text-white rounded-sm"
            style={{ background: 'var(--court)' }}
          >
            Save location
          </button>
          <Link
            href={`/profile/${username}`}
            style={{ fontSize: '0.85rem', color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  )
}
