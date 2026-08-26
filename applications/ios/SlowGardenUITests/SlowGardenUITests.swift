import XCTest

final class SlowGardenUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testMultipleGardensAndSeedToBloomJourney() throws {
        let app = XCUIApplication()
        app.launchArguments = ["--ui-testing"]
        app.launch()

        app.buttons["garden-manager-button"].tap()
        let gardenName = app.textFields["Garden name"]
        gardenName.tap()
        gardenName.typeText("Work Garden")
        app.buttons["create-garden-button"].tap()
        app.navigationBars.buttons["Done"].tap()
        XCTAssertTrue(app.buttons["Work Garden"].exists)

        let texts = [
            "Leave room before naming the solution.",
            "What changes once this becomes a roadmap?",
            "The form should not interrupt the idea.",
        ]
        for text in texts {
            app.buttons["plant-seed-button"].tap()
            let editor = app.textViews["seed-text-editor"]
            XCTAssertTrue(editor.waitForExistence(timeout: 2))
            editor.typeText(text)
            app.buttons["save-seed-button"].tap()
        }

        app.buttons["request-tending-button"].tap()
        let review = app.buttons["review-bloom-button"]
        XCTAssertTrue(review.waitForExistence(timeout: 10))
        review.tap()

        XCTAssertTrue(app.staticTexts["Source clippings"].exists)
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'evidence-'")).count, 3)
        app.buttons["response-keep"].tap()
        XCTAssertTrue(app.staticTexts["Kept in your garden"].waitForExistence(timeout: 2))
        app.buttons["return-to-meadow-button"].tap()
        XCTAssertTrue(app.buttons["plant-seed-button"].exists)
    }
}
