// Aplica landing_web2.sql + SIEMBRA los fallbacks del código como registros.
// Correr: node apply_landing_web2.js  (idempotente: solo siembra columnas null / reseñas nuevas)
const { Client } = require('pg'); const fs = require('fs');
const c = new Client({ host: 'aws-1-us-west-2.pooler.supabase.com', port: 5432, user: 'postgres.lintmcxqxnrholslatul', password: fs.readFileSync(__dirname + '/.pgpass', 'utf8').trim(), database: 'postgres', ssl: { rejectUnauthorized: false } });

const SOBRE = {
  p1: "En quechua, munay significa amar, querer — la belleza que nace del afecto. Así atendemos: como se recibe a alguien querido que vuelve a casa.",
  p1_en: "In Quechua, munay means to love, to care — the beauty born from affection. That's how we host: the way you welcome a loved one coming back home.",
  p2: "Somos parte del Grupo Paracas Sights & Tours, operadores del muelle desde hace años. Por eso en Casa Munay no solo duermes bien: zarpas con nosotros a las Ballestas, sin intermediarios.",
  p2_en: "We are part of Grupo Paracas Sights & Tours, pier operators for years. That's why at Casa Munay you don't just sleep well: you sail with us to the Ballestas, no middlemen.",
  firma: "— Paty & el equipo Munay",
  fotos: ["https://picsum.photos/seed/munayhotel/700/500", "https://picsum.photos/seed/munayroom/600/460", "https://picsum.photos/seed/munaydet/400/400"]
};

const AMENIDADES = [
  { ic: "📶", t: "Wi-Fi gratis", t_en: "Free Wi-Fi", d: "en todo el hotel", d_en: "throughout the hotel", visible: true },
  { ic: "🍳", t: "Desayuno", t_en: "Breakfast", d: "opcional, casero", d_en: "optional, homemade", visible: true },
  { ic: "🚿", t: "Agua caliente", t_en: "Hot water", d: "24 horas", d_en: "24 hours", visible: true },
  { ic: "❄️", t: "Ventilador / A-C", t_en: "Fan / A-C", d: "según habitación", d_en: "depending on room", visible: true },
  { ic: "🚗", t: "Estacionamiento", t_en: "Parking", d: "consultar", d_en: "ask us", visible: true },
  { ic: "🧳", t: "Guarda equipaje", t_en: "Luggage storage", d: "sin costo", d_en: "free of charge", visible: true },
  { ic: "🚐", t: "Traslados", t_en: "Transfers", d: "terminal ↔ hotel", d_en: "terminal ↔ hotel", visible: true },
  { ic: "⚓", t: "Tours propios", t_en: "Our own tours", d: "reserva en recepción", d_en: "book at reception", visible: true },
  { ic: "🕒", t: "Check-in 14:00", t_en: "Check-in 14:00", d: "check-out 11:00", d_en: "check-out 11:00", visible: true },
  { ic: "🗣️", t: "ES / EN", t_en: "ES / EN", d: "atención bilingüe", d_en: "bilingual service", visible: true }
];

const DIA = [
  { ic: "🌅", hora: "7:00", titulo: "Despiertas frente a la bahía", titulo_en: "You wake up facing the bay", texto: "Desayuno casero y el mar a unos pasos. El bote ya te espera con tu nombre en la lista.", texto_en: "Homemade breakfast and the sea just steps away. The boat is already waiting with your name on the list.", foto: "https://picsum.photos/seed/mdia1/1000/440" },
  { ic: "🚤", hora: "8:00", titulo: "Zarpas a las Islas Ballestas", titulo_en: "You sail to the Ballestas Islands", texto: "Lobos marinos, pingüinos de Humboldt y el Candelabro. Con nuestra propia flota: sin colas, sin intermediarios.", texto_en: "Sea lions, Humboldt penguins and the Candelabra. With our own fleet: no queues, no middlemen.", foto: "https://picsum.photos/seed/mdia2/1000/440" },
  { ic: "🏜️", hora: "15:00", titulo: "Reserva Nacional de Paracas", titulo_en: "Paracas National Reserve", texto: "Playa Roja, La Catedral y el desierto tocando el mar. El atardecer más fotografiado del sur.", texto_en: "Red Beach, La Catedral and the desert touching the sea. The most photographed sunset in the south.", foto: "https://picsum.photos/seed/mdia3/1000/440" },
  { ic: "🌙", hora: "20:00", titulo: "Vuelves a casa", titulo_en: "You come back home", texto: "Ceviche en el malecón, una ducha caliente y la cama que te quiere bien. Mañana: ¿Huacachina o Nazca?", texto_en: "Ceviche on the boardwalk, a hot shower and the bed that cares for you. Tomorrow: Huacachina or Nazca?", foto: "https://picsum.photos/seed/mdia4/1000/440" }
];

const TOURS = [
  { slug: "islas-ballestas", titulo: "Islas Ballestas", titulo_en: "Ballestas Islands", precio: 85, duracion: "2 h · salida 8:00 am", duracion_en: "2 h · departs 8:00 am", foto: "https://picsum.photos/seed/mtour1/800/900",
    descripcion: "Lobos marinos, pingüinos de Humboldt y el Candelabro. El clásico imperdible de Paracas.", descripcion_en: "Sea lions, Humboldt penguins and the Candelabra. The Paracas classic you can't miss.",
    contenido: "Las Islas Ballestas son conocidas como las \"pequeñas Galápagos del Perú\": colonias de lobos marinos que descansan sobre las rocas, pingüinos de Humboldt, zarcillos y miles de aves guaneras, además del misterioso Candelabro dibujado en la ladera del cerro. El recorrido en bote bordea las islas (no se desembarca — son reserva protegida) y dura alrededor de 2 horas desde el muelle El Chaco.\n\n¿Por qué con nosotros? Porque somos Paracas Sights & Tours, operadores del muelle con flota propia: tu cupo está asegurado, no dependemos de terceros y como huésped de Casa Munay tienes tarifa preferente y embarque sin colas — desayunas en el hotel y caminas 3 minutos al bote.\n\nRecomendaciones: llegar 20 minutos antes, llevar cortaviento (la brisa de mar es fresca a las 8 am), bloqueador, gorra y cámara. El mar suele estar calmado en la mañana; por eso zarpamos temprano.",
    contenido_en: "The Ballestas Islands are known as \"Peru's little Galapagos\": colonies of sea lions resting on the rocks, Humboldt penguins, Inca terns and thousands of guano birds, plus the mysterious Candelabra drawn on the hillside. The boat tour circles the islands (no disembarking — they are a protected reserve) and takes around 2 hours from El Chaco pier.\n\nWhy with us? Because we are Paracas Sights & Tours, pier operators with our own fleet: your spot is guaranteed, we don't depend on third parties, and as a Casa Munay guest you get a preferred rate and no-queue boarding.\n\nTips: arrive 20 minutes early, bring a windbreaker, sunscreen, a cap and your camera." },
  { slug: "reserva-de-paracas", titulo: "Reserva Nacional de Paracas", titulo_en: "Paracas National Reserve", precio: 75, duracion: "3.5 h", duracion_en: "3.5 h", foto: "https://picsum.photos/seed/mtour2/800/900",
    descripcion: "Playa Roja, La Catedral y el desierto tocando el mar. El atardecer más fotografiado del sur.", descripcion_en: "Red Beach, La Catedral and the desert touching the sea. The most photographed sunset in the south.",
    contenido: "La Reserva Nacional de Paracas es el único lugar del Perú donde el desierto cae directamente sobre el mar. El circuito visita la Playa Roja (arena granate por el magma solidificado), el mirador de La Catedral, la playa Lagunillas y los acantilados donde anidan aves marinas. Al atardecer, el desierto se pinta exactamente de los colores de nuestra casa: guinda y oro.\n\nSalimos por la tarde para que la luz sea la mejor del día — es el tour favorito de los fotógrafos. Como huésped de Casa Munay coordinas el horario en recepción y combinas Ballestas (mañana) + Reserva (tarde) en un solo día perfecto.",
    contenido_en: "The Paracas National Reserve is the only place in Peru where the desert drops straight into the sea. The circuit visits Red Beach, the La Catedral viewpoint, Lagunillas beach and the cliffs where seabirds nest.\n\nWe leave in the afternoon so the light is the best of the day — it's the photographers' favorite tour. Combine Ballestas (morning) + Reserve (afternoon) in one perfect day." },
  { slug: "huacachina-sandboard", titulo: "Huacachina + Sandboard", titulo_en: "Huacachina + Sandboarding", precio: 90, duracion: "Medio día", duracion_en: "Half day", foto: "https://picsum.photos/seed/mtour3/800/900",
    descripcion: "Oasis, buggies y adrenalina en las dunas de Ica.", descripcion_en: "Oasis, dune buggies and adrenaline in the Ica dunes.", contenido: "", contenido_en: "" },
  { slug: "sobrevuelo-nazca", titulo: "Sobrevuelo Líneas de Nazca", titulo_en: "Nazca Lines Flight", precio: 350, duracion: "1.5 h de vuelo", duracion_en: "1.5 h flight", foto: "https://picsum.photos/seed/mtour4/800/900",
    descripcion: "Las líneas milenarias desde el cielo, saliendo del aeródromo de Pisco.", descripcion_en: "The millenary lines from the sky, departing from Pisco airfield.", contenido: "", contenido_en: "" },
  { slug: "city-tour-ica", titulo: "City Tour Ica + Bodegas", titulo_en: "Ica City Tour + Wineries", precio: 45, duracion: "Medio día", duracion_en: "Half day", foto: "https://picsum.photos/seed/mtour5/800/900",
    descripcion: "Pisco, vino y tradición iqueña en las bodegas de la región.", descripcion_en: "Pisco, wine and Ica tradition at the region's wineries.", contenido: "", contenido_en: "" },
  { slug: "transfers-paquetes", titulo: "Transfers & paquetes", titulo_en: "Transfers & packages", precio: null, duracion: "A tu medida", duracion_en: "Made to measure", foto: "https://picsum.photos/seed/mtour6/800/900",
    descripcion: "Terminal ↔ hotel, aeropuerto de Pisco, y combos hotel + tours con descuento.", descripcion_en: "Bus terminal ↔ hotel, Pisco airport, and hotel + tour combos with discounts.", contenido: "", contenido_en: "" }
];

const RESENAS = [
  { nombre: "María & José", origen: "Lima · Familia", rating: 5, comentario: "La atención de Paty y su equipo es de otro nivel. Nos armaron el tour a Ballestas desde el mismo hotel, cero estrés.", local_id: "seed-1" },
  { nombre: "Sarah K.", origen: "USA · Pareja", rating: 5, comentario: "Best location and the sunset from the terrace is unreal. They run their own boats — the tour was seamless.", local_id: "seed-2" },
  { nombre: "Carlos R.", origen: "Arequipa · Amigos", rating: 5, comentario: "Limpio, cómodo y a pasos del malecón. El desayuno casero y el traslado al terminal nos salvaron el viaje.", local_id: "seed-3" },
  { nombre: "Ana Lucía", origen: "Cusco · Pareja", rating: 5, comentario: "Volvimos por segunda vez. La suite con terraza vale cada sol: atardecer + pisco = perfecto.", local_id: "seed-4" },
  { nombre: "Tom H.", origen: "UK · Mochilero", rating: 4, comentario: "Great value. Rooms are simple but spotless, and booking the Ballestas tour at reception saved us money.", local_id: "seed-5" }
];

(async () => {
  await c.connect();
  await c.query(fs.readFileSync(__dirname + '/landing_web2.sql', 'utf8'));
  console.log('SQL aplicado OK');

  // Sembrar SOLO columnas aún vacías (no pisar ediciones del panel)
  await c.query(`update web_contenido set
      sobre      = coalesce(sobre, $1::jsonb),
      amenidades = coalesce(amenidades, $2::jsonb),
      dia        = coalesce(dia, $3::jsonb),
      tours      = coalesce(tours, $4::jsonb)
    where sitio = 'casamunay'`,
    [JSON.stringify(SOBRE), JSON.stringify(AMENIDADES), JSON.stringify(DIA), JSON.stringify(TOURS)]);
  console.log('secciones sembradas');

  // Reseñas fallback → publicadas (idempotente por local_id)
  for (const r of RESENAS) {
    await c.query(`insert into web_testimonios (sitio, nombre, origen, rating, comentario, pendiente, visible, local_id)
      values ('casamunay', $1, $2, $3, $4, false, true, $5)
      on conflict (local_id) where local_id is not null do nothing`, [r.nombre, r.origen, r.rating, r.comentario, r.local_id]);
  }
  const n = await c.query("select count(*)::int n from web_testimonios where sitio='casamunay' and visible");
  console.log('reseñas publicadas en BD:', n.rows[0].n);

  // Verificación
  const v = await c.query("select jsonb_array_length(amenidades) a, jsonb_array_length(dia) d, jsonb_array_length(tours) t, (sobre->'fotos'->>0) is not null s from web_contenido where sitio='casamunay'");
  console.log('verify:', JSON.stringify(v.rows[0]));
  await c.end();
})().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
