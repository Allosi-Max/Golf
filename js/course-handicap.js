// Preview only; PostgreSQL recalculates from authenticated profile snapshots.
export function teeSettings(slope, rating, par) {
    if ([slope, rating, par].some(v => v == null || String(v).trim() === '')) throw new Error('The selected tee is missing Slope Rating, Course Rating or Par. Choose another tee or ask for the course data to be updated.');
    const settings = { slope: Number(slope), rating: Number(rating), par: Number(par) };
    if (!Number.isInteger(settings.slope) || settings.slope < 55 || settings.slope > 155
        || !Number.isFinite(settings.rating) || settings.rating < 1 || settings.rating > 144
        || !Number.isInteger(settings.par) || settings.par < 1 || settings.par > 144) throw new Error('Invalid tee ratings: slope must be 55–155, CR 1–144 and par 1–144.');
    return settings;
}
export function courseHandicap(index, settings) {
    // Decimal arithmetic as an integer fraction avoids floating-point half-tie errors.
    const fraction = value => {
        const [whole, decimals = ''] = String(value).split('.');
        return [BigInt(whole + decimals), 10n ** BigInt(decimals.length)];
    };
    const [hi, hd] = fraction(index), [cr, cd] = fraction(settings.rating);
    const denominator = hd * 113n * cd;
    const numerator = hi * BigInt(settings.slope) * cd + (cr - BigInt(settings.par) * cd) * hd * 113n;
    const absolute = numerator < 0n ? -numerator : numerator;
    // Nearest integer, exact halves away from zero, matching PostgreSQL numeric round.
    return Number((absolute * 2n + denominator) / (2n * denominator)) * (numerator < 0n ? -1 : 1);
}
