import { Temporal } from '@js-temporal/polyfill';
import { DateWithNanosecondsDelta } from '../value-parser';

export interface TemporalBinding {
  timezone: string;
  instant: Temporal.Instant;
}


export interface TemporalDateObject {
  year: number;
  month: number;
  day: number;
}

export interface TemporalTimeObject {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  microsecond: number;
  nanosecond: number;
}

export interface TemporalObject extends TemporalDateObject, TemporalTimeObject {
  // timezone offset nanoseconds
  offsetNanoseconds: number;
}

const TIMEZONE_REGEX_STRING = '(?<tZs>[+-])?((?<tZh>0[0-9]|1[0-3])(:(?<tZm>[0-5][0-9]))?|(?<tZh14>14(:(?<tZm00>00))?))';
const TIME_REGEX_STRING =
    '(?<h>[0-1][0-9]|2[0-3]):(?<m>[0-5][0-9])(:(?<s>[0-5][0-9])(.(\\s)?(?<ms>[0-9]{0,3})(?<mcs>[0-9]{0,3})?(?<ns>[0-9]{0,3})?)?)?';
const DATE_REGEX_STRING = '(?<y>[0-9]{4})-(?<M>(0[1-9]|1[0-2]))-(?<d>(0[1-9]|[1-2][0-9]|3[0-1]))';

const TIMEZONE_REGEX = new RegExp('^' + TIMEZONE_REGEX_STRING);

const TIME_REGEX = new RegExp('^' + TIME_REGEX_STRING + '$');
const TIME_TIMEZONE_REGEX = new RegExp('^' + TIME_REGEX_STRING + '((?<tZ>Z)|((\\s)?' + TIMEZONE_REGEX_STRING + '))$');
const DATE_REGEX = new RegExp('^' + DATE_REGEX_STRING + '$');
const DATE_TIME_REGEX = new RegExp('^' + DATE_REGEX_STRING + '(\\s|T)' + TIME_REGEX_STRING + '$');
const DATE_TIME_TIMEZONE_REGEX = new RegExp(
    '^' + DATE_REGEX_STRING + '(\\s|T)' + TIME_REGEX_STRING + '((?<tZ>Z)|((\\s)?' + TIMEZONE_REGEX_STRING + '))$'
);

export enum TemporalTypeCheck {
    FULL = 0,
    NOTIMEZONE = 1,
    ERROR = 3
}

export function timeZoneToTemporalOffsetNanoseconds(timezone: string): number {
    timezone = timezone.trim();
    if (TIMEZONE_REGEX.test(timezone)) {
        let sign,
            hours = '00',
            minutes = '00';
        const match = timezone.match(TIMEZONE_REGEX);
        if (match && match.groups) {
            if (!match.groups.tZ) {
                sign = match.groups.tZs ?? '+';
                if (match.groups.tZh) {
                    hours = match.groups.tZh;
                    minutes = match.groups.tZm ?? minutes;
                } else if (match.groups.tZh14) {
                    hours = '14';
                    minutes = '00';
                }
            }
        }
        const offset = Number(hours) * 60 + Number(minutes);
        return offset === 0 ? 0 : offset * (sign === '+' ? 1 : -1) * 60_000_000_000;
    }

    return 0;
}

export function nanoSecondsOffsetToTimezone(nanoSecondsOffset: number | null): string {
    return offsetToTimezone(nanoSecondsOffsetToOffset(nanoSecondsOffset));
}

export function offsetToTimezone(offset: number): string {
    if (offset === 0) {
        return '+00:00';
    } else {
        return `${offset < 0 ? '-' : '+'}${Math.floor(Math.abs(offset) / 60)
            .toString()
            .padStart(2, '0')}:${(Math.abs(offset) % 60).toString().padStart(2, '0')}`;
    }
}

export function nanoSecondsOffsetToOffset(nanoSecondsOffset: number | null): number {
    if (nanoSecondsOffset === 0 || nanoSecondsOffset === null) {
        return 0;
    } else {
        return Math.round(nanoSecondsOffset / 60_000_000_000);
    }
}

function extractTemporalDateFromRegexMatch(match: RegExpMatchArray | null): TemporalDateObject {
    let year, month, day;
    if (match && match.groups) {
        year = match.groups.y;
        month = match.groups.M;
        day = match.groups.d;
    }

    return {
        year: Number(year ?? '1900'),
        month: Number(month ?? '01'),
        day: Number(day ?? '01')
    };
}

function extractTemporalTimeFromRegexMatch(
    match: RegExpMatchArray | null,
    temporalTypeCheck: TemporalTypeCheck
): TemporalTimeObject {
    let hour, minute, second, millisecond, microsecond, nanosecond;
    if (match && match.groups) {
        hour = match.groups.h;
        minute = match.groups.m;
        second = match.groups.s;
        millisecond = match.groups.ms;
        microsecond = match.groups.mcs;
        nanosecond = match.groups.ns;
        const userMicorAndNano = (millisecond?.length ?? 0) + (microsecond?.length ?? 0) + (nanosecond?.length ?? 0);
        if (temporalTypeCheck === TemporalTypeCheck.ERROR && userMicorAndNano > 3) {
            throw new TypeError('Conversion failed when converting date and/or time from character string.');
        }
    }

    return {
        hour: Number(hour ?? '00'),
        minute: Number(minute ?? '00'),
        second: Number(second ?? '00'),
        millisecond: Number(millisecond ? millisecond.padEnd(3, '0') : '000'),
        microsecond: Number(microsecond ? microsecond.padEnd(3, '0') : '000'),
        nanosecond: Number(nanosecond ? nanosecond.padEnd(3, '0') : '000')
    };
}

function extractTemporalOffsetNanoSecondsFromRegexMatch(
    match: RegExpMatchArray | null,
    temporalTypeCheck: TemporalTypeCheck
): number {
    let timezone;
    if (match && match.groups) {
        if (!match.groups.tZ) {
            const sign = match.groups.tZs ?? '+';
            if (match.groups.tZh) {
                timezone = sign + match.groups.tZh + ':' + (match.groups.tZm ?? '00');
            } else if (match.groups.tZh14) {
                timezone = sign + '14:00';
            }
        }
    }

    if (temporalTypeCheck === TemporalTypeCheck.NOTIMEZONE) {
        timezone = '+00:00';
    }

    return timeZoneToTemporalOffsetNanoseconds(timezone ?? '+00:00');
}

function extractTemporalObejctFromMatch(
    match: RegExpMatchArray | null,
    temporalTypeCheck: TemporalTypeCheck
): TemporalObject {
    const temporalTimeObject = extractTemporalTimeFromRegexMatch(match, temporalTypeCheck);
    const temporalDateObject = extractTemporalDateFromRegexMatch(match);
    const zdt = Temporal.ZonedDateTime.from({
        ...temporalDateObject,
        ...temporalTimeObject,
        timeZone: 'UTC'
    });

    return {
        year: zdt.year,
        month: zdt.month,
        day: zdt.day,
        hour: zdt.hour,
        minute: zdt.minute,
        second: zdt.second,
        millisecond: zdt.millisecond,
        microsecond: zdt.microsecond,
        nanosecond: zdt.nanosecond,
        offsetNanoseconds: extractTemporalOffsetNanoSecondsFromRegexMatch(match, temporalTypeCheck)
    };
}

export function stringToTemporalObject(date: string, temporalTypeCheck: TemporalTypeCheck): TemporalObject | null {
    date = date.replace(/\s\s+/g, ' ').trim();
    if (TIME_REGEX.test(date)) {
        return extractTemporalObejctFromMatch(date.match(TIME_REGEX), temporalTypeCheck);
    }

    if (TIME_TIMEZONE_REGEX.test(date)) {
        return extractTemporalObejctFromMatch(date.match(TIME_TIMEZONE_REGEX), temporalTypeCheck);
    }

    if (DATE_REGEX.test(date)) {
        return extractTemporalObejctFromMatch(date.match(DATE_REGEX), temporalTypeCheck);
    }

    if (DATE_TIME_REGEX.test(date)) {
        return extractTemporalObejctFromMatch(date.match(DATE_TIME_REGEX), temporalTypeCheck);
    }

    if (DATE_TIME_TIMEZONE_REGEX.test(date)) {
        return extractTemporalObejctFromMatch(date.match(DATE_TIME_TIMEZONE_REGEX), temporalTypeCheck);
    }

    return null;
}

export function temporalBindingFromTemporalObject(temporalObject: TemporalObject): TemporalBinding {
    const timezone = nanoSecondsOffsetToTimezone(temporalObject.offsetNanoseconds);

    return {
        timezone,
        instant: Temporal.Instant.from(
            `${temporalObject.year.toString().padStart(4, '0')}-${temporalObject.month
                .toString()
                .padStart(2, '0')}-${temporalObject.day.toString().padStart(2, '0')} ${temporalObject.hour
                .toString()
                .padStart(2, '0')}:${temporalObject.minute.toString().padStart(2, '0')}:${temporalObject.second
                .toString()
                .padStart(2, '0')}.${temporalObject.millisecond.toString().padStart(3, '0')}${temporalObject.microsecond
                .toString()
                .padStart(3, '0')}${temporalObject.nanosecond.toString().padStart(3, '0')}${timezone}`
        )
    };
}

export function temporalBindingFromTediousDate(
    date: Date | DateWithNanosecondsDelta,
    temporalTypeCheck: TemporalTypeCheck
): TemporalBinding {
    let microsecond = 0;
    let nanosecond = 0;
    if ('nanosecondsDelta' in date) {
        if ((date.nanosecondsDelta as number).toString().length > 5 && temporalTypeCheck === TemporalTypeCheck.ERROR) {
            throw new TypeError('Conversion failed when converting date.');
        } else {
            const int = Math.round(Number((date.nanosecondsDelta as number).toString().slice(0, 11)) * 1_000_000_000);
            microsecond = Math.floor(int / 1000);
            nanosecond = Math.floor(((int / 1000) % 1) * Math.pow(10, 3));
        }
    }

    return temporalBindingFromTemporalObject({
        year: date.getFullYear(),
        month: date.getMonth() + 1,
        day: date.getDate(),
        hour: date.getHours(),
        minute: date.getMinutes(),
        second: date.getSeconds(),
        millisecond: date.getMilliseconds(),
        microsecond: microsecond,
        nanosecond: nanosecond,
        offsetNanoseconds: date.getTimezoneOffset() * -60_000_000_000
    });
}

export function getTemporalDurationFromTemporalZdt(zdt: Temporal.ZonedDateTime): Temporal.Duration {
    return Temporal.Duration.from({
        hours: zdt.hour,
        minutes: zdt.minute,
        seconds: zdt.second,
        milliseconds: zdt.millisecond,
        microseconds: zdt.microsecond,
        nanoseconds: zdt.nanosecond
    });
}

export function getDaysSinceYearOneDayOneFromTemporalZdt(zdt: Temporal.ZonedDateTime): number {
    const zeroDate = Temporal.Instant.from('0001-01-01 00:00:00.0000000Z').toZonedDateTimeISO('+00:00');
    const utcDate = Temporal.Instant.from(
        `${zdt.year.toString().padStart(4, '0')}-${zdt.month.toString().padStart(2, '0')}-${zdt.day
            .toString()
            .padStart(2, '0')} 00:00:00.0000000Z`
    ).toZonedDateTimeISO('+00:00');

    return utcDate.since(zeroDate, { largestUnit: 'day' }).days;
}

export function getDaysSince1900DayOneFromTemporalZdt(zdt: Temporal.ZonedDateTime): number {
    const zeroDate = Temporal.Instant.from('1900-01-01 00:00:00.0000000Z').toZonedDateTimeISO('+00:00');
    const utcDate = Temporal.Instant.from(
        `${zdt.year.toString().padStart(4, '0')}-${zdt.month.toString().padStart(2, '0')}-${zdt.day
            .toString()
            .padStart(2, '0')} 00:00:00.0000000Z`
    ).toZonedDateTimeISO('+00:00');

    return utcDate.since(zeroDate, { largestUnit: 'day' }).days;
}

export function getSqlServerTimeFromTemporalZdt(zdt: Temporal.ZonedDateTime, scale: number): number {
    return Math.round(
        (getTemporalDurationFromTemporalZdt(zdt).total('nanosecond') / 1_000_000_000) * Math.pow(10, scale)
    );
}

export function getSqlServerMinutesFromTemporalZdt(zdt: Temporal.ZonedDateTime): number {
    const duration = getTemporalDurationFromTemporalZdt(zdt);

    return (
        duration.hours * 60 +
        duration.minutes +
        Math.floor(Math.round((duration.seconds * 1000 + duration.milliseconds) / 3) / 10000)
    );
}

export function getSqlServerThreeHundredthsOfSecondFromTemporalZdt(zdt: Temporal.ZonedDateTime): number {
    return Math.round(
        Math.round(getTemporalDurationFromTemporalZdt(zdt).total('nanosecond') / 1_000_000) / (3 + 1 / 3)
    );
}
