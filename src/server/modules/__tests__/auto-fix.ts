import { Position, TextEdit } from 'vscode-languageserver-types';
import type winston from 'winston';
import { CommandId } from '../../types';
import type { LanguageServerOptions, LanguageServerModuleConstructorParameters } from '../../types';

import { AutoFixModule } from '../auto-fix';

const mockOptions: LanguageServerOptions = {
	packageManager: 'npm',
	validate: [],
	snippet: [],
};

const mockContext = {
	connection: {
		onExecuteCommand: jest.fn(),
		workspace: {
			applyEdit: jest.fn(),
		},
	},
	documents: { get: jest.fn() },
	getOptions: jest.fn(async () => mockOptions),
	getFixes: jest.fn(),
};

const mockLogger = {
	debug: jest.fn(),
	isDebugEnabled: jest.fn(() => true),
} as unknown as jest.Mocked<winston.Logger>;

const getParams = (passLogger = false) =>
	({
		context: mockContext,
		logger: passLogger ? mockLogger : undefined,
	} as unknown as LanguageServerModuleConstructorParameters);

describe('AutoFixModule', () => {
	beforeEach(() => {
		mockOptions.validate = [];
		jest.clearAllMocks();
	});

	test('should be constructable', () => {
		expect(() => new AutoFixModule(getParams())).not.toThrow();
	});

	test('onInitialize should return results', () => {
		const module = new AutoFixModule(getParams());

		expect(module.onInitialize()).toMatchSnapshot();
	});

	test('onDidRegisterHandlers should register an auto-fix command handler', () => {
		const module = new AutoFixModule(getParams());

		module.onDidRegisterHandlers();

		expect(mockContext.connection.onExecuteCommand).toHaveBeenCalledTimes(1);
		expect(mockContext.connection.onExecuteCommand).toHaveBeenCalledWith(expect.any(Function));
	});

	test('should auto-fix documents', async () => {
		mockContext.documents.get.mockReturnValue({
			uri: 'foo',
			languageId: 'bar',
			version: 1,
		});
		mockOptions.validate = ['bar'];
		mockContext.getFixes.mockReturnValue([TextEdit.insert(Position.create(0, 0), 'text')]);
		mockContext.connection.workspace.applyEdit.mockResolvedValue({ applied: true });

		const module = new AutoFixModule(getParams(true));

		module.onDidRegisterHandlers();

		const handler = mockContext.connection.onExecuteCommand.mock.calls[0][0];

		const result = await handler({
			command: CommandId.ApplyAutoFix,
			arguments: [{ uri: 'foo', version: 1 }],
		});

		expect(result).toStrictEqual({});
		expect(mockContext.getFixes).toHaveBeenCalledWith({
			languageId: 'bar',
			uri: 'foo',
			version: 1,
		});
		expect(mockContext.connection.workspace.applyEdit.mock.calls[0]).toMatchSnapshot();
	});

	test('with incorrect command, should not attempt to auto-fix', async () => {
		const module = new AutoFixModule(getParams());

		module.onDidRegisterHandlers();

		const handler = mockContext.connection.onExecuteCommand.mock.calls[0][0];

		const result = await handler({ command: 'foo' });

		expect(result).toStrictEqual({});
		expect(mockContext.getFixes).not.toHaveBeenCalled();
	});

	test('with no arguments, should not attempt to auto-fix', async () => {
		const module = new AutoFixModule(getParams());

		module.onDidRegisterHandlers();

		const handler = mockContext.connection.onExecuteCommand.mock.calls[0][0];

		const result = await handler({ command: CommandId.ApplyAutoFix });

		expect(result).toStrictEqual({});
		expect(mockContext.getFixes).not.toHaveBeenCalled();
	});

	test('if no matching document exists, should not attempt to auto-fix', async () => {
		mockContext.documents.get.mockReturnValue(undefined);

		const module = new AutoFixModule(getParams(true));

		module.onDidRegisterHandlers();

		const handler = mockContext.connection.onExecuteCommand.mock.calls[0][0];

		const result = await handler({
			command: CommandId.ApplyAutoFix,
			arguments: [{ uri: 'foo' }],
		});

		expect(result).toStrictEqual({});
		expect(mockContext.getFixes).not.toHaveBeenCalled();
		expect(mockLogger.debug).toHaveBeenLastCalledWith('Unknown document, ignoring', { uri: 'foo' });
	});

	test('if document language ID is not in options, should not attempt to auto-fix', async () => {
		mockContext.documents.get.mockReturnValue({
			uri: 'foo',
			languageId: 'bar',
		});
		mockOptions.validate = ['baz'];

		const module = new AutoFixModule(getParams(true));

		module.onDidRegisterHandlers();

		const handler = mockContext.connection.onExecuteCommand.mock.calls[0][0];

		const result = await handler({
			command: CommandId.ApplyAutoFix,
			arguments: [{ uri: 'foo' }],
		});

		expect(result).toStrictEqual({});
		expect(mockContext.getFixes).not.toHaveBeenCalled();
		expect(mockLogger.debug).toHaveBeenLastCalledWith(
			'Document should not be auto-fixed, ignoring',
			{
				uri: 'foo',
				language: 'bar',
			},
		);
	});

	test('with no debug log level and no valid document, should not attempt to log reason', async () => {
		mockContext.documents.get.mockReturnValue({
			uri: 'foo',
			languageId: 'bar',
		});
		mockOptions.validate = ['baz'];
		mockLogger.isDebugEnabled.mockReturnValue(false);

		const module = new AutoFixModule(getParams(true));

		module.onDidRegisterHandlers();

		const handler = mockContext.connection.onExecuteCommand.mock.calls[0][0];

		const handlerParams = {
			command: CommandId.ApplyAutoFix,
			arguments: [{ uri: 'foo' }],
		};

		const result = await handler(handlerParams);

		expect(result).toStrictEqual({});
		expect(mockContext.getFixes).not.toHaveBeenCalled();
		expect(mockLogger.debug).toHaveBeenLastCalledWith('Received onExecuteCommand', handlerParams);
	});

	test('if the document has been modified, should not attempt to auto-fix', async () => {
		mockContext.documents.get.mockReturnValue({
			uri: 'foo',
			languageId: 'bar',
			version: 2,
		});
		mockOptions.validate = ['bar'];

		const module = new AutoFixModule(getParams(true));

		module.onDidRegisterHandlers();

		const handler = mockContext.connection.onExecuteCommand.mock.calls[0][0];

		const result = await handler({
			command: CommandId.ApplyAutoFix,
			arguments: [{ uri: 'foo', version: 1 }],
		});

		expect(result).toStrictEqual({});
		expect(mockContext.getFixes).not.toHaveBeenCalled();
		expect(mockLogger.debug).toHaveBeenLastCalledWith('Document has been modified, ignoring', {
			uri: 'foo',
		});
	});

	test('if fixes fail to apply, should log the response', async () => {
		const response = { applied: false, failureReason: 'foo' };

		mockContext.documents.get.mockReturnValue({
			uri: 'foo',
			languageId: 'bar',
			version: 1,
		});
		mockOptions.validate = ['bar'];
		mockContext.getFixes.mockReturnValue([TextEdit.insert(Position.create(0, 0), 'text')]);
		mockContext.connection.workspace.applyEdit.mockResolvedValue(response);

		const module = new AutoFixModule(getParams(true));

		module.onDidRegisterHandlers();

		const handler = mockContext.connection.onExecuteCommand.mock.calls[0][0];

		const result = await handler({
			command: CommandId.ApplyAutoFix,
			arguments: [{ uri: 'foo', version: 1 }],
		});

		expect(result).toStrictEqual({});
		expect(mockLogger.debug).toHaveBeenLastCalledWith('Failed to apply fixes', {
			uri: 'foo',
			response,
		});
	});

	test('if an error occurs while applying fixes, should log it', async () => {
		const error = new Error('foo');

		mockContext.documents.get.mockReturnValue({
			uri: 'foo',
			languageId: 'bar',
			version: 1,
		});
		mockOptions.validate = ['bar'];
		mockContext.getFixes.mockReturnValue([TextEdit.insert(Position.create(0, 0), 'text')]);
		mockContext.connection.workspace.applyEdit.mockRejectedValue(error);

		const module = new AutoFixModule(getParams(true));

		module.onDidRegisterHandlers();

		const handler = mockContext.connection.onExecuteCommand.mock.calls[0][0];

		const result = await handler({
			command: CommandId.ApplyAutoFix,
			arguments: [{ uri: 'foo', version: 1 }],
		});

		expect(result).toStrictEqual({});
		expect(mockLogger.debug).toHaveBeenLastCalledWith('Failed to apply fixes', {
			uri: 'foo',
			error,
		});
	});
});
