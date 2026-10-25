import {
  ExecutionContext,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { JsonContentTypeGuard } from '../guards/json-content-type.guard';

const contextFor = (contentType: string | null): ExecutionContext => {
  const request = {
    is: (type: string) => {
      if (!contentType) return null;

      return contentType.split(';')[0].trim() === type ? type : false;
    },
  };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
};

describe('JsonContentTypeGuard', () => {
  const guard = new JsonContentTypeGuard();

  it.each(['application/json', 'application/json; charset=utf-8'])(
    'lets %s through',
    (contentType) => {
      expect(guard.canActivate(contextFor(contentType))).toBe(true);
    },
  );

  it.each([
    'application/x-www-form-urlencoded',
    'text/plain',
    'multipart/form-data; boundary=x',
    null,
  ])('answers 415 to %p', (contentType) => {
    expect(() => guard.canActivate(contextFor(contentType))).toThrow(
      UnsupportedMediaTypeException,
    );
  });
});
